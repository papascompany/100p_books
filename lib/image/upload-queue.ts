"use client";

import { nanoid } from "nanoid";
import { create } from "zustand";

import type { Photo } from "@/lib/db/types";
import { UPLOAD_CONCURRENCY } from "./constants";
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
  thumbDataUrl?: string;
  width?: number;
  height?: number;
  exifTakenAt?: string | null;
  exifCamera?: string | null;
  orderIdx: number;
  createdAt: number;
}

interface UploadStoreState {
  items: UploadItem[];
  /** 0..1 — 모든 아이템 진행률 평균 */
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

function recomputeOverall(items: UploadItem[]): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((acc, i) => {
    if (i.status === "done") return acc + 1;
    if (i.status === "error" || i.status === "cancelled") return acc + 1;
    return acc + Math.min(0.99, i.progress);
  }, 0);
  return sum / items.length;
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
        ? { ...i, status: "pending" as UploadStatus, progress: 0, error: undefined }
        : i,
    );
    set({ items: next, overall: recomputeOverall(next) });
    queueRef?.tick();
  },

  cancelAll: () => {
    queueRef?.cancelAll();
    const next = get().items.map((i) =>
      i.status === "done"
        ? i
        : { ...i, status: "cancelled" as UploadStatus, error: "취소됨" },
    );
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

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!res.ok || !json.ok) {
    throw new Error(json.error?.message ?? `요청 실패 (${res.status})`);
  }
  return json.data as T;
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

  /** store 가 변경된 뒤 호출 — 슬롯이 비어있으면 다음 작업 시작 */
  tick() {
    const store = useUploadStore.getState();
    while (this.inFlight.size < this.concurrency) {
      const next = store.items.find(
        (i) => i.status === "pending" && !this.inFlight.has(i.id),
      );
      if (!next) break;
      this.processItem(next);
    }
    store._setBusy(this.inFlight.size > 0 || this.pendingComplete.length > 0);
  }

  cancelAll() {
    for (const a of this.aborters.values()) a.abort();
    this.aborters.clear();
    this.inFlight.clear();
    if (this.completeTimer) {
      clearTimeout(this.completeTimer);
      this.completeTimer = null;
    }
    this.pendingComplete = [];
  }

  destroy() {
    this.cancelAll();
    if (queueRef === this) queueRef = null;
  }

  // -----------------------------------------------------------

  private async processItem(item: UploadItem) {
    this.inFlight.add(item.id);
    const abort = new AbortController();
    this.aborters.set(item.id, abort);

    const store = useUploadStore.getState();
    const patch = (p: Partial<UploadItem>) => store._patch(item.id, p);

    try {
      // 1) HEIC 변환
      patch({ status: "converting", progress: 0.02 });
      const converted = await convertHeicIfNeeded(item.file);
      const effective = converted;

      // 2) EXIF + probe
      patch({ status: "reading", progress: 0.08, effectiveFile: effective });
      const [exif, dims] = await Promise.all([
        extractExifMeta(effective),
        probeImage(effective),
      ]);

      // 3) sign-upload (단일 파일)
      const signed = await postJson<SignUploadResponse["data"]>(
        "/api/photos/sign-upload",
        {
          projectId: this.projectId,
          files: [
            {
              filename: effective.name,
              mime: effective.type || "image/jpeg",
              size: effective.size,
            },
          ],
        },
        abort.signal,
      );

      const sig = signed[0];
      if (!sig) throw new Error("서명 URL 응답이 비어있습니다.");

      patch({
        status: "uploading",
        progress: 0.12,
        photoId: sig.photoId,
        storageKey: sig.storageKey,
        width: dims.width,
        height: dims.height,
        exifTakenAt: exif.takenAt ? exif.takenAt.toISOString() : null,
        exifCamera: exif.camera,
      });

      // 4) PUT 업로드 (진행률 12% → 95%)
      await putWithProgress(
        sig.uploadUrl,
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
          photoId: sig.photoId,
          storageKey: sig.storageKey,
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
      this.flushComplete();
      return;
    }

    this.completeTimer = setTimeout(() => {
      this.flushComplete();
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
      const result = await postJson<CompleteResponse["data"]>(
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
      store._setBusy(this.inFlight.size > 0 || this.pendingComplete.length > 0);
    }
  }
}
