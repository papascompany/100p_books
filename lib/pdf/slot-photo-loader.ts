import "server-only";

import { loadImage, type Canvas } from "@napi-rs/canvas";

import type { PageDoc } from "@/lib/layout/types";

import { SLOT_RASTER_CACHE_MAX_BYTES } from "./constants";
import {
  readSlotPhotoMeta,
  resizePhotoToCanvas,
  slotDownscalePlan,
  warnDownscaleFailure,
  type SlotImage,
  type SlotPhotoMeta,
} from "./photo-downscale";

/**
 * 빌드 1회용 사진 슬롯 로더 — 같은 사진을 여러 번 그릴 때 원본 다운로드·디코드를 반복하지 않는다.
 *
 * 왜 필요한가 (D5 linux-x64 실측 2026-11-10, STATUS §0-36):
 *   원본 바이트 캐시(PhotoCache, 100MB)는 48MP 원본(~19MB)을 5장 남짓만 담는다. 사진 100장을 6번씩
 *   재사용하는 collage-6 100p 에서 원본을 601회 받았고(적중 0%), 그릴 때마다 원본을 다시 디코드·축소했다.
 *   1vCPU 에뮬레이션 렌더가 약 297s 로 함수 한도(300s)에 붙었다.
 *
 * 방식:
 *   1. 사진별 헤더 정보(크기·EXIF 방향)를 한 번 읽어 둔다(수십 바이트).
 *   2. 축소 경로(photo-downscale.ts 와 같은 판정)의 결과 캔버스를
 *      (photoId, fit, 목표 정수 크기) 로 캐시한다. 축소 결과는 이 세 값과 원본 바이트로만 정해지고,
 *      원본은 빌드 동안 photoId 별로 같으므로 **같은 키 = 같은 픽셀**이다. 캐시는 바이트 상한으로 묶는다.
 *   3. 캐시 적중이면 원본을 받지 않는다. 원본은 축소 결과가 없을 때와 기존 경로(업스케일·
 *      orientation≠1·sharp 실패 → loadImage)에서만 resolve 한다. 기존 경로는 결과를 캐시하지 않는다(그대로).
 *
 * 내보내기 정책 — 다음 사용이 가장 먼 항목부터(Belady):
 *   collage 는 같은 사진이 십수 페이지 간격으로 다시 나온다. 작업 집합이 캐시보다 크면 LRU 는 순환 접근에서
 *   적중 0% 가 된다. 렌더 전에 PageDoc 에서 사진별 사용 순서(plan)를 세어 두고, 넘칠 때는 다음 사용이 가장
 *   먼 항목(다시 안 쓰이면 무한대)을 내보낸다 — 새 항목 자신이 가장 멀면 넣지 않는 것과 같다.
 *   plan 이 없으면 LRU 로 동작한다. 정책은 적중률만 바꾸고 픽셀은 바꾸지 않는다.
 *
 * 원본 바이트 캐시와의 관계 (`releaseOriginal`):
 *   사진의 남은 사용이 0 이 되거나 축소 결과가 캐시에 남아 있으면 원본은 당분간 필요 없으므로
 *   원본 캐시에서 빼도록 알린다 — 원본 캐시 자리를 아직 축소 결과가 없는 사진에게 넘긴다.
 *   잘못 빼도 다시 받을 뿐 결과는 같다.
 */

export type CropMode = "cover" | "contain" | undefined;

export type LoadSlotPhoto = (
  photoId: string,
  slot: { wPx: number; hPx: number },
  cropMode: CropMode,
) => Promise<SlotImage>;

export interface SlotPhotoLoaderStats {
  /** resolve(원본 다운로드) 호출 수. */
  fetches: number;
  /** 축소 결과 캐시 적중 수. */
  rasterHits: number;
  /** 축소를 새로 수행한 수. */
  rasterMisses: number;
  /** 바이트 상한 때문에 내보낸 수(새 항목을 넣지 않은 경우 포함). */
  evictions: number;
  /** 캐시가 동시에 들고 있던 최대 바이트. */
  peakBytes: number;
}

export interface SlotPhotoLoaderOpts {
  /** photoId → 원본 바이트 (검증 포함 — createPhotoResolver). */
  resolve: (photoId: string) => Promise<Buffer>;
  /** 렌더 순서대로의 PageDoc — 사용 계획(plan). 없으면 LRU. */
  docs?: readonly PageDoc[];
  /** 축소 결과 캐시 상한(byte). */
  maxBytes?: number;
  /** 원본이 더 필요 없을 때 원본 캐시에서 빼는 훅 (예: PhotoCache.delete). */
  releaseOriginal?: (photoId: string) => void;
}

export interface SlotPhotoLoader {
  load: LoadSlotPhoto;
  stats: () => SlotPhotoLoaderStats;
}

/** 렌더 순서 기준 사진별 사용 위치(오름차순). 배경 이미지는 슬롯 경로가 아니라 세지 않는다. */
export function planPhotoUses(docs: readonly PageDoc[]): Map<string, number[]> {
  const plan = new Map<string, number[]>();
  let pos = 0;
  for (const doc of docs) {
    for (const obj of doc.objects) {
      if (obj.type !== "photo") continue;
      const list = plan.get(obj.photoId);
      if (list) list.push(pos);
      else plan.set(obj.photoId, [pos]);
      pos += 1;
    }
  }
  return plan;
}

interface RasterEntry<V> {
  value: V;
  bytes: number;
  group: string;
  touched: number;
}

/**
 * 바이트 상한 캐시. 넘치면 `nextUse(group)` 이 가장 큰(다음 사용이 가장 먼) 항목부터 내보내고,
 * 같으면 가장 오래 안 쓴 항목부터 내보낸다. nextUse 가 늘 0 이면 순수 LRU.
 */
export class ByteBudgetCache<V> {
  private readonly map = new Map<string, RasterEntry<V>>();
  private bytes = 0;
  private tick = 0;
  peakBytes = 0;
  evictions = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly nextUse: (group: string) => number = () => 0,
  ) {}

  get size(): number {
    return this.map.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    e.touched = ++this.tick;
    return e.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  hasGroup(group: string): boolean {
    for (const e of this.map.values()) if (e.group === group) return true;
    return false;
  }

  /** 넣고 상한까지 내보낸다. 새 항목이 내보내졌으면 false. */
  set(key: string, value: V, bytes: number, group: string): boolean {
    if (bytes > this.maxBytes) {
      this.evictions += 1;
      return false;
    }
    this.delete(key);
    this.map.set(key, { value, bytes, group, touched: ++this.tick });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes) {
      const victim = this.pickVictim();
      if (victim === null) break;
      this.delete(victim);
      this.evictions += 1;
    }
    if (this.bytes > this.peakBytes) this.peakBytes = this.bytes;
    return this.map.has(key);
  }

  delete(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    this.map.delete(key);
    this.bytes -= e.bytes;
  }

  deleteGroup(group: string): void {
    for (const [k, e] of this.map) if (e.group === group) this.delete(k);
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  private pickVictim(): string | null {
    let best: string | null = null;
    let bestUse = -Infinity;
    let bestTouched = Infinity;
    for (const [k, e] of this.map) {
      const use = this.nextUse(e.group);
      if (use > bestUse || (use === bestUse && e.touched < bestTouched)) {
        best = k;
        bestUse = use;
        bestTouched = e.touched;
      }
    }
    return best;
  }
}

function canvasBytes(c: Canvas): number {
  return c.width * c.height * 4;
}

export function createSlotPhotoLoader(opts: SlotPhotoLoaderOpts): SlotPhotoLoader {
  const plan = opts.docs ? planPhotoUses(opts.docs) : null;
  const nextUse = (photoId: string): number => {
    if (!plan) return 0;
    return plan.get(photoId)?.[0] ?? Infinity;
  };
  const rasters = new ByteBudgetCache<Canvas>(opts.maxBytes ?? SLOT_RASTER_CACHE_MAX_BYTES, nextUse);
  const metas = new Map<string, SlotPhotoMeta>();
  const inflight = new Map<string, Promise<Canvas | null>>();
  const active = new Map<string, number>();
  const counters = { fetches: 0, rasterHits: 0, rasterMisses: 0 };

  async function fetchOriginal(photoId: string): Promise<Buffer> {
    counters.fetches += 1;
    return opts.resolve(photoId);
  }

  async function loadInner(
    photoId: string,
    slot: { wPx: number; hPx: number },
    cropMode: CropMode,
  ): Promise<SlotImage> {
    let buf: Buffer | null = null;
    const getBuf = async (): Promise<Buffer> => {
      if (!buf) buf = await fetchOriginal(photoId);
      return buf;
    };

    // decodePhotoForSlot 와 같은 판정 — 헤더 읽기 실패(sharp 차단·손상)면 경고 후 원본 loadImage.
    let meta = metas.get(photoId);
    if (!meta) {
      const b = await getBuf();
      try {
        meta = await readSlotPhotoMeta(b);
        metas.set(photoId, meta);
      } catch (e) {
        warnDownscaleFailure(e);
        return loadImage(b);
      }
    }

    const target = slotDownscalePlan(meta, slot, cropMode);
    if (target) {
      const fit = cropMode === "contain" ? "inside" : "cover";
      const key = `${photoId}\u0000${fit}\u0000${target.width}x${target.height}`;
      const hit = rasters.get(key);
      if (hit) {
        counters.rasterHits += 1;
        return hit;
      }
      let pending = inflight.get(key);
      if (pending) {
        counters.rasterHits += 1;
      } else {
        counters.rasterMisses += 1;
        // await 전에 inflight 에 등록해야 동시 요청이 같은 작업을 기다린다.
        pending = (async (): Promise<Canvas | null> => {
          // 원본 resolve 실패는 reject → 호출 측 placeholder (기존과 같음).
          const b = await getBuf();
          try {
            const c = await resizePhotoToCanvas(b, target, cropMode);
            rasters.set(key, c, canvasBytes(c), photoId);
            return c;
          } catch (e) {
            warnDownscaleFailure(e);
            return null;
          }
        })();
        inflight.set(key, pending);
        const clear = (): void => {
          inflight.delete(key);
        };
        // finally() 는 reject 를 다시 던져 unhandled rejection 이 된다 — 양쪽 모두 처리.
        pending.then(clear, clear);
      }
      const c = await pending;
      if (c) return c;
    }
    return loadImage(await getBuf());
  }

  async function load(
    photoId: string,
    slot: { wPx: number; hPx: number },
    cropMode: CropMode,
  ): Promise<SlotImage> {
    plan?.get(photoId)?.shift(); // 이번 사용을 소비
    active.set(photoId, (active.get(photoId) ?? 0) + 1);
    try {
      return await loadInner(photoId, slot, cropMode);
    } finally {
      const n = (active.get(photoId) ?? 1) - 1;
      if (n > 0) active.set(photoId, n);
      else active.delete(photoId);
      if (n <= 0) {
        if (plan && nextUse(photoId) === Infinity) {
          // 더 이상 쓰이지 않는 사진 — 축소 결과·헤더·원본 모두 놓는다.
          rasters.deleteGroup(photoId);
          metas.delete(photoId);
          opts.releaseOriginal?.(photoId);
        } else if (rasters.hasGroup(photoId)) {
          opts.releaseOriginal?.(photoId);
        }
      }
    }
  }

  return {
    load,
    stats: () => ({
      ...counters,
      evictions: rasters.evictions,
      peakBytes: rasters.peakBytes,
    }),
  };
}
