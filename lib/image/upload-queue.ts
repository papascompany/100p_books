"use client";

import { nanoid } from "nanoid";
import { create } from "zustand";

import type { Photo } from "@/lib/db/types";
import {
  CLIENT_THUMB_LONG_EDGE,
  SIGN_BATCH_SIZE,
  UPLOAD_CONCURRENCY,
} from "./constants";
import { extractExifMeta } from "./exif";
import { convertHeicIfNeeded } from "./heic";
import { probeImage } from "./probe";
import { validateFile } from "./validate";

// ─────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────

export type UploadStatus =
  | "pending"
  | "converting"
  | "reading"
  | "uploading"
  | "done"
  | "error"
  | "cancelled";

export interface UploadItem {
  id: string;
  file: File;
  /** HEIC 변환 후의 실제 업로드 파일 (없으면 file 와 동일) */
  effectiveFile?: File;
  status: UploadStatus;
  progress: number; // 0..1
  error?: string;
  photoId?: string;
  storageKey?: string;
  /** 배치 서명으로 받은 Storage 업로드 URL. */
  uploadUrl?: string;
  /**
   * 그리드 표시용 소형 썸네일 URL.
   * 로컬 업로드 항목은 canvas 로 만든 dataURL, 서버 복원 항목은 signed thumb URL.
   */
  thumbDataUrl?: string;
  width?: number;
  height?: number;
  exifTakenAt?: string | null;
  exifCamera?: string | null;
  orderIdx: number;
  createdAt: number;
}

/** 서버에 이미 업로드된 사진을 그리드에 복원하기 위한 seed (UP-2). */
export interface ServerPhotoSeed {
  photoId: string;
  filename: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
  orderIdx: number;
}

interface UploadStoreState {
  items: UploadItem[];
  /** 0..1 — 실패·취소를 제외한 항목들의 진행률 평균 */
  overall: number;
  /** 1번이라도 addFiles 가 호출됐는지 */
  started: boolean;
  /** 진행 중 작업이 하나라도 있는지 */
  busy: boolean;
  /** 다중 선택된 아이템 id 집합 */
  selectedIds: Set<string>;

  addFiles: (files: File[]) => void;
  remove: (id: string) => void;
  removeMany: (ids: string[]) => void;
  retry: (id: string) => void;
  cancelAll: () => void;
  /** 프로젝트 전환/재진입 시 store 전체 초기화 (UP-3). */
  reset: () => void;
  /** 서버에 이미 존재하는 사진을 done 항목으로 합류 — photoId 기준 중복 없이 (UP-2). */
  seedServerPhotos: (photos: ServerPhotoSeed[]) => void;

  // 다중 선택 헬퍼
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  selectAll: () => void;
  clearSelection: () => void;

  /** 내부 — UploadQueue 가 호출 */
  _patch: (id: string, patch: Partial<UploadItem>) => void;
  _setBusy: (b: boolean) => void;
}

// ─────────────────────────────────────────────────────────────
// store
// ─────────────────────────────────────────────────────────────

let queueRef: UploadQueue | null = null;

/**
 * 전체 진행률 — 실패·취소 항목은 분모/분자에서 제외 (UP-9).
 * (실패를 완료로 집계하면 실패가 섞여도 100% 로 표시되는 모순이 생긴다)
 */
function recomputeOverall(items: UploadItem[]): number {
  const active = items.filter(
    (i) => i.status !== "error" && i.status !== "cancelled",
  );
  if (active.length === 0) return 0;
  const sum = active.reduce((acc, i) => {
    if (i.status === "done") return acc + 1;
    return acc + Math.min(0.99, i.progress);
  }, 0);
  return sum / active.length;
}

export const useUploadStore = create<UploadStoreState>()((set, get) => ({
  items: [],
  overall: 0,
  started: false,
  busy: false,
  selectedIds: new Set<string>(),

  addFiles: (files) => {
    const existing = get().items;
    const startIdx = existing.length;
    const accepted: UploadItem[] = [];
    files.forEach((file, i) => {
      const errMsg = validateFile({ name: file.name, type: file.type, size: file.size });
      const item: UploadItem = {
        id: nanoid(10),
        file,
        status: errMsg ? "error" : "pending",
        progress: 0,
        error: errMsg ?? undefined,
        orderIdx: startIdx + i,
        createdAt: Date.now(),
      };
      accepted.push(item);
    });
    const next = [...existing, ...accepted];
    set({ items: next, overall: recomputeOverall(next), started: true });
    queueRef?.tick();
  },

  remove: (id) => {
    const next = get().items.filter((i) => i.id !== id);
    // orderIdx 재정렬
    next.forEach((it, idx) => {
      it.orderIdx = idx;
    });
    const sel = new Set(get().selectedIds);
    sel.delete(id);
    set({ items: next, overall: recomputeOverall(next), selectedIds: sel });
  },

  removeMany: (ids) => {
    if (ids.length === 0) return;
    const removeSet = new Set(ids);
    const next = get().items.filter((i) => !removeSet.has(i.id));
    next.forEach((it, idx) => {
      it.orderIdx = idx;
    });
    const sel = new Set(get().selectedIds);
    for (const id of ids) sel.delete(id);
    set({ items: next, overall: recomputeOverall(next), selectedIds: sel });
  },

  retry: (id) => {
    const next = get().items.map((i) =>
      i.id === id && (i.status === "error" || i.status === "cancelled")
        ? {
            ...i,
            status: "pending" as UploadStatus,
            progress: 0,
            error: undefined,
            // 재시도는 새 photoId 로 다시 서명 (storage 키 충돌·1회성 URL 재사용 방지)
            photoId: undefined,
            storageKey: undefined,
            uploadUrl: undefined,
          }
        : i,
    );
    set({ items: next, overall: recomputeOverall(next) });
    queueRef?.tick();
  },

  cancelAll: () => {
    queueRef?.cancelAll();
    // '업로드 취소' — 진행 중 abort + 미완료(대기·진행·실패·취소) 항목을 목록에서 제거 (UP-8).
    // 서버에 반영된 done 항목은 유지 (삭제는 선택 모드/개별 X 로 명시적으로).
    const next = get().items.filter((i) => i.status === "done");
    next.forEach((it, idx) => {
      it.orderIdx = idx;
    });
    const keptIds = new Set(next.map((i) => i.id));
    const sel = new Set<string>();
    for (const id of get().selectedIds) {
      if (keptIds.has(id)) sel.add(id);
    }
    set({ items: next, overall: recomputeOverall(next), selectedIds: sel });
  },

  reset: () => {
    queueRef?.cancelAll();
    set({
      items: [],
      overall: 0,
      started: false,
      busy: false,
      selectedIds: new Set<string>(),
    });
  },

  seedServerPhotos: (photos) => {
    if (photos.length === 0) return;
    const existing = get().items;
    const knownPhotoIds = new Set(
      existing.map((i) => i.photoId).filter((v): v is string => !!v),
    );
    const seeds: UploadItem[] = [];
    for (const p of photos) {
      if (knownPhotoIds.has(p.photoId)) continue;
      seeds.push({
        id: nanoid(10),
        // 서버 복원 항목 — 원본 File 은 없으므로 이름/타입만 가진 빈 File 로 대체.
        file: new File([], p.filename ?? "photo.jpg", {
          type: p.mime ?? "image/jpeg",
        }),
        status: "done",
        progress: 1,
        photoId: p.photoId,
        thumbDataUrl: p.thumbUrl ?? undefined,
        width: p.width ?? undefined,
        height: p.height ?? undefined,
        orderIdx: 0,
        createdAt: Date.now(),
      });
    }
    if (seeds.length === 0) return;
    // 서버 사진이 먼저 업로드된 것이므로 앞에 배치 후 orderIdx 재계산
    const next = [...seeds, ...existing];
    next.forEach((it, idx) => {
      it.orderIdx = idx;
    });
    set({ items: next, overall: recomputeOverall(next) });
  },

  toggleSelected: (id) => {
    const sel = new Set(get().selectedIds);
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    set({ selectedIds: sel });
  },

  setSelected: (ids) => {
    set({ selectedIds: new Set(ids) });
  },

  selectAll: () => {
    set({ selectedIds: new Set(get().items.map((i) => i.id)) });
  },

  clearSelection: () => {
    set({ selectedIds: new Set() });
  },

  _patch: (id, patch) => {
    const next = get().items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    set({ items: next, overall: recomputeOverall(next) });
  },

  _setBusy: (b) => set({ busy: b }),
}));

// ─────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────

interface SignUploadResponse {
  ok: true;
  data: Array<{ photoId: string; uploadUrl: string; storageKey: string; token: string }>;
}

interface CompleteResponse {
  ok: true;
  data: {
    inserted: Photo[];
    failed: Array<{ photoId: string; error: string }>;
  };
}

/** API 실패 — HTTP status 와 (429 시) rate limit resetAt 을 보존. */
class UploadApiError extends Error {
  readonly status: number;
  readonly resetAt?: number;

  constructor(message: string, status: number, resetAt?: number) {
    super(message);
    this.name = "UploadApiError";
    this.status = status;
    this.resetAt = resetAt;
  }
}

function parseResetAt(details: unknown): number | undefined {
  if (
    details &&
    typeof details === "object" &&
    "resetAt" in details &&
    typeof (details as { resetAt: unknown }).resetAt === "number"
  ) {
    return (details as { resetAt: number }).resetAt;
  }
  return undefined;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; data?: T; error?: { message?: string; details?: unknown } }
    | null;
  if (!res.ok || !json?.ok) {
    throw new UploadApiError(
      json?.error?.message ?? `요청 실패 (${res.status})`,
      res.status,
      parseResetAt(json?.error?.details),
    );
  }
  return json.data as T;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("취소됨"));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("취소됨"));
      },
      { once: true },
    );
  });
}

/** 429 재시도 상한. */
const MAX_RATE_LIMIT_RETRIES = 4;

/**
 * postJson + 429(rate limit) 자동 백오프 재시도 (UP-1).
 * 서버가 알려준 resetAt 까지 대기하는 것을 우선하고, 없으면 지수 백오프.
 */
async function postJsonWithBackoff<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postJson<T>(url, body, signal);
    } catch (e) {
      const retryable =
        e instanceof UploadApiError &&
        e.status === 429 &&
        attempt < MAX_RATE_LIMIT_RETRIES &&
        !signal?.aborted;
      if (!retryable) throw e;
      const backoffMs = Math.min(2 ** attempt * 2000, 30_000);
      const untilResetMs = e.resetAt ? e.resetAt - Date.now() : 0;
      const waitMs =
        Math.min(Math.max(untilResetMs, backoffMs), 61_000) +
        Math.floor(Math.random() * 500);
      await sleep(waitMs, signal);
    }
  }
}

function putWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (p: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`업로드 실패 (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("네트워크 오류"));
    xhr.onabort = () => reject(new Error("취소됨"));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(blob);
  });
}

// ─────────────────────────────────────────────────────────────
// 클라이언트 썸네일 (UP-10)
// ─────────────────────────────────────────────────────────────

/**
 * 그리드 셀 표시용 소형 썸네일 dataURL 생성.
 * 원본 풀사이즈 blob URL 을 <img> 에 그대로 물리면 100장 스크롤 시
 * 풀해상도 디코딩이 반복되어 모바일 메모리 압박 → 탭 강제 리로드 위험.
 */
async function makeThumbDataUrl(
  file: Blob,
  width: number,
  height: number,
): Promise<string | undefined> {
  try {
    const scale = Math.min(1, CLIENT_THUMB_LONG_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const bitmap = await createImageBitmap(file, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: "medium",
    });
    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      ctx.drawImage(bitmap, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", 0.72);
    } finally {
      bitmap.close();
    }
  } catch {
    // 썸네일 실패는 치명적이지 않음 — 그리드는 상태 폴백 UI 표시
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────
// 배치 서명 메타 (UP-1)
// ─────────────────────────────────────────────────────────────

/**
 * 서명은 변환 전에 배치로 일어나므로, HEIC 는 변환 후(JPEG) 기준의 메타를 예측해 요청.
 * (storage 키 확장자·서버 MIME 검증이 실제 업로드 파일과 일치하도록)
 */
function predictUploadMeta(file: File): { filename: string; mime: string; size: number } {
  const mime = (file.type || "").toLowerCase();
  const rawName = file.name || "photo.jpg";
  const looksHeic =
    mime === "image/heic" ||
    mime === "image/heif" ||
    /\.(heic|heif)$/i.test(rawName);
  const name = looksHeic ? `${rawName.replace(/\.[^.]+$/i, "")}.jpg` : rawName;
  // 서버 zod 제약 (filename max 255) 방어 — 넘치면 뒤쪽(확장자 포함)을 보존
  const safeName = name.length > 255 ? name.slice(name.length - 255) : name;
  return {
    filename: safeName,
    mime: looksHeic ? "image/jpeg" : mime || "image/jpeg",
    size: file.size,
  };
}

// ─────────────────────────────────────────────────────────────
// UploadQueue
// ─────────────────────────────────────────────────────────────

export interface UploadQueueOptions {
  projectId: string;
  /** 기본 6 */
  concurrency?: number;
}

export class UploadQueue {
  private projectId: string;
  private concurrency: number;
  private inFlight = new Set<string>();
  private aborters = new Map<string, AbortController>();
  /** 배치 서명 진행 중인 아이템 id. */
  private signInFlight = new Set<string>();
  /** 배치 서명 루프 재진입 방지. */
  private signing = false;
  private signAbort = new AbortController();
  private destroyed = false;
  /** complete 콜백 대기열 — 업로드 완료 직후 누적해서 배치로 보냄 */
  private pendingComplete: Array<UploadItem> = [];
  private completeTimer: ReturnType<typeof setTimeout> | null = null;
  /** complete 배치 발사 디바운스 (ms) — 새 파일이 추가되면 재시작 */
  private static COMPLETE_DEBOUNCE = 800;
  /** 한 번의 complete 호출에 묶을 최대 개수 */
  private static COMPLETE_MAX_BATCH = 25;

  constructor(opts: UploadQueueOptions) {
    this.projectId = opts.projectId;
    this.concurrency = opts.concurrency ?? UPLOAD_CONCURRENCY;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    queueRef = this;
  }

  /** store 가 변경된 뒤 호출 — 서명 배치를 채우고, 슬롯이 비어있으면 다음 작업 시작 */
  tick() {
    if (this.destroyed) return;
    void this.ensureSigned();
    this.startUploads();
    this.syncBusy();
  }

  cancelAll() {
    for (const a of this.aborters.values()) a.abort();
    this.aborters.clear();
    this.inFlight.clear();
    this.signAbort.abort();
    this.signAbort = new AbortController();
    this.signInFlight.clear();
    if (this.completeTimer) {
      clearTimeout(this.completeTimer);
      this.completeTimer = null;
    }
    this.pendingComplete = [];
  }

  destroy() {
    this.destroyed = true;
    this.cancelAll();
    if (queueRef === this) queueRef = null;
  }

  // -----------------------------------------------------------

  private startUploads() {
    const store = useUploadStore.getState();
    while (this.inFlight.size < this.concurrency) {
      // 배치 서명이 끝난(uploadUrl 보유) pending 항목만 시작
      const next = store.items.find(
        (i) =>
          i.status === "pending" && !!i.uploadUrl && !this.inFlight.has(i.id),
      );
      if (!next) break;
      void this.processItem(next);
    }
  }

  private syncBusy() {
    const store = useUploadStore.getState();
    store._setBusy(
      this.inFlight.size > 0 ||
        this.pendingComplete.length > 0 ||
        this.signInFlight.size > 0,
    );
  }

  /**
   * UP-1: 서명되지 않은 pending 항목을 SIGN_BATCH_SIZE 단위로 묶어
   * 한 번의 sign-upload 호출로 일괄 서명 (100장 → 5회).
   * 429 는 postJsonWithBackoff 가 resetAt 기반 백오프로 재시도.
   */
  private async ensureSigned(): Promise<void> {
    if (this.signing || this.destroyed) return;
    this.signing = true;
    try {
      for (;;) {
        if (this.destroyed) return;
        const store = useUploadStore.getState();
        const unsigned = store.items.filter(
          (i) =>
            i.status === "pending" &&
            !i.uploadUrl &&
            !this.signInFlight.has(i.id),
        );
        if (unsigned.length === 0) break;

        const batch = unsigned.slice(0, SIGN_BATCH_SIZE);
        for (const item of batch) this.signInFlight.add(item.id);
        this.syncBusy();
        const signal = this.signAbort.signal;

        try {
          const signed = await postJsonWithBackoff<SignUploadResponse["data"]>(
            "/api/photos/sign-upload",
            {
              projectId: this.projectId,
              files: batch.map((item) => predictUploadMeta(item.file)),
            },
            signal,
          );
          if (this.destroyed) return;
          const s = useUploadStore.getState();
          batch.forEach((item, idx) => {
            const sig = signed[idx];
            if (sig) {
              s._patch(item.id, {
                photoId: sig.photoId,
                storageKey: sig.storageKey,
                uploadUrl: sig.uploadUrl,
              });
            } else {
              s._patch(item.id, {
                status: "error",
                error: "서명 URL 응답이 비어있습니다.",
              });
            }
          });
        } catch (e) {
          if (this.destroyed) return;
          const msg = e instanceof Error ? e.message : "업로드 준비에 실패했습니다.";
          const isAbort = signal.aborted || msg.includes("취소");
          const s = useUploadStore.getState();
          for (const item of batch) {
            s._patch(item.id, {
              status: isAbort ? "cancelled" : "error",
              error: isAbort ? "취소됨" : msg,
            });
          }
          if (isAbort) return;
        } finally {
          for (const item of batch) this.signInFlight.delete(item.id);
        }

        // 서명된 항목은 다음 배치 서명과 병행해 즉시 업로드 시작
        this.startUploads();
      }
    } finally {
      this.signing = false;
      this.syncBusy();
    }
  }

  private async processItem(item: UploadItem) {
    this.inFlight.add(item.id);
    const abort = new AbortController();
    this.aborters.set(item.id, abort);

    const store = useUploadStore.getState();
    const patch = (p: Partial<UploadItem>) => store._patch(item.id, p);

    try {
      const { photoId, storageKey, uploadUrl } = item;
      if (!photoId || !storageKey || !uploadUrl) {
        throw new Error("업로드 준비 정보가 없습니다. 다시 시도해 주세요.");
      }

      // 1) HEIC 변환
      patch({ status: "converting", progress: 0.02 });
      const effective = await convertHeicIfNeeded(item.file);

      // 2) EXIF + probe
      patch({ status: "reading", progress: 0.08, effectiveFile: effective });
      const [exif, dims] = await Promise.all([
        extractExifMeta(effective),
        probeImage(effective),
      ]);

      // 3) 그리드용 소형 썸네일 (UP-10) — 실패해도 업로드는 계속
      const thumbDataUrl = await makeThumbDataUrl(
        effective,
        dims.width,
        dims.height,
      );

      patch({
        status: "uploading",
        progress: 0.12,
        thumbDataUrl,
        width: dims.width,
        height: dims.height,
        exifTakenAt: exif.takenAt ? exif.takenAt.toISOString() : null,
        exifCamera: exif.camera,
      });

      // 4) PUT 업로드 (진행률 12% → 95%)
      await putWithProgress(
        uploadUrl,
        effective,
        effective.type || "image/jpeg",
        (p) => {
          // 12% 부터 95% 까지를 업로드 진행률에 매핑
          patch({ progress: 0.12 + p * 0.83 });
        },
        abort.signal,
      );

      patch({ progress: 0.97 });

      // 5) complete 큐에 추가 (배치 발사)
      const completed = useUploadStore.getState().items.find((i) => i.id === item.id);
      if (completed) {
        this.pendingComplete.push({
          ...completed,
          photoId,
          storageKey,
          width: dims.width,
          height: dims.height,
          exifTakenAt: exif.takenAt ? exif.takenAt.toISOString() : null,
          exifCamera: exif.camera,
          effectiveFile: effective,
        });
      }
      this.scheduleComplete();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "알 수 없는 오류";
      const isAbort = msg.includes("취소") || abort.signal.aborted;
      patch({
        status: isAbort ? "cancelled" : "error",
        error: isAbort ? "취소됨" : msg,
      });
    } finally {
      this.aborters.delete(item.id);
      this.inFlight.delete(item.id);
      // 다음 슬롯 진행
      this.tick();
    }
  }

  private scheduleComplete() {
    if (this.completeTimer) clearTimeout(this.completeTimer);

    // 큐가 가득 차면 즉시 발사
    if (this.pendingComplete.length >= UploadQueue.COMPLETE_MAX_BATCH) {
      void this.flushComplete();
      return;
    }

    this.completeTimer = setTimeout(() => {
      void this.flushComplete();
    }, UploadQueue.COMPLETE_DEBOUNCE);
  }

  private async flushComplete() {
    if (this.completeTimer) {
      clearTimeout(this.completeTimer);
      this.completeTimer = null;
    }

    const batch = this.pendingComplete.splice(0, UploadQueue.COMPLETE_MAX_BATCH);
    if (batch.length === 0) return;

    const store = useUploadStore.getState();
    try {
      const result = await postJsonWithBackoff<CompleteResponse["data"]>(
        "/api/photos/complete",
        {
          projectId: this.projectId,
          photos: batch.map((b) => ({
            photoId: b.photoId,
            storageKey: b.storageKey,
            filename: (b.effectiveFile ?? b.file).name,
            mime: (b.effectiveFile ?? b.file).type || "image/jpeg",
            sizeBytes: (b.effectiveFile ?? b.file).size,
            width: b.width,
            height: b.height,
            exifTakenAt: b.exifTakenAt ?? null,
            exifCamera: b.exifCamera ?? null,
            orderIdx: b.orderIdx,
          })),
        },
      );

      const insertedIds = new Set(result.inserted.map((p) => p.id));
      const failedMap = new Map(result.failed.map((f) => [f.photoId, f.error]));

      for (const item of batch) {
        if (item.photoId && insertedIds.has(item.photoId)) {
          store._patch(item.id, { status: "done", progress: 1 });
        } else {
          store._patch(item.id, {
            status: "error",
            error:
              (item.photoId && failedMap.get(item.photoId)) ??
              "서버 처리 중 실패",
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "complete 호출 실패";
      for (const item of batch) {
        store._patch(item.id, { status: "error", error: msg });
      }
    } finally {
      // 남아있는 항목이 있으면 재스케줄
      if (this.pendingComplete.length > 0) this.scheduleComplete();
      this.syncBusy();
    }
  }
}
