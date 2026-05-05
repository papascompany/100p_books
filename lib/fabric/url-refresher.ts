/**
 * signedUrl 만료 처리 — 캔버스 로드 후 일정 시간(기본 55분)이 지나면
 * `/api/pages/[id]` 를 다시 호출해 photoUrls 를 갱신하고
 * 캔버스에 올라간 fabric.Image 객체의 src 를 교체한다.
 *
 * Supabase signed URL 기본 TTL 은 3600s. 안전 마진 5분.
 */

import * as fabric from "fabric";

import type { TaggedFabricObject } from "./serialize";

export interface RefreshResult {
  ok: boolean;
  photoUrls?: Record<string, string>;
  error?: string;
}

export interface UrlRefresherOpts {
  pageId: string;
  /** 갱신 간격(ms). 기본 55분. */
  intervalMs?: number;
  /** 갱신된 URL 을 캔버스에 반영할 콜백 (FabricStage 가 fabric.Image.setSrc 호출). */
  onRefresh: (photoUrls: Record<string, string>) => void;
}

/**
 * 타이머 시작. 정리 함수 반환.
 */
export function startUrlRefresher(opts: UrlRefresherOpts): () => void {
  const interval = opts.intervalMs ?? 55 * 60 * 1000;

  let cancelled = false;
  const timer = setInterval(async () => {
    if (cancelled) return;
    const result = await fetchPagePhotoUrls(opts.pageId);
    if (cancelled) return;
    if (result.ok && result.photoUrls) {
      opts.onRefresh(result.photoUrls);
    }
  }, interval);

  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}

/**
 * 단일 페이지 photoUrls 재요청.
 */
export async function fetchPagePhotoUrls(
  pageId: string,
): Promise<RefreshResult> {
  try {
    const res = await fetch(`/api/pages/${pageId}`, {
      cache: "no-store",
    });
    const json = (await res.json()) as {
      ok: boolean;
      data?: { photoUrls?: Record<string, string> };
      error?: { message: string };
    };
    if (!res.ok || !json.ok || !json.data) {
      return {
        ok: false,
        error: json.error?.message ?? "URL 갱신 실패",
      };
    }
    return { ok: true, photoUrls: json.data.photoUrls ?? {} };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "URL 갱신 실패",
    };
  }
}

/**
 * 캔버스 위 photo 객체들의 src 를 새 photoUrls 에 맞춰 교체.
 *
 * fabric.Image#setSrc(url) 는 비동기 — Promise.all 로 일괄 처리.
 */
export async function applyPhotoUrlsToCanvas(
  canvas: fabric.Canvas,
  photoUrls: Record<string, string>,
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const obj of canvas.getObjects()) {
    const tagged = obj as TaggedFabricObject;
    if (tagged.oType !== "photo" || !tagged.photoId) continue;
    const url = photoUrls[tagged.photoId];
    if (!url) continue;
    if (obj instanceof fabric.FabricImage) {
      tasks.push(
        (obj as fabric.FabricImage).setSrc(url, { crossOrigin: "anonymous" }),
      );
    }
  }
  await Promise.all(tasks);
  canvas.requestRenderAll();
}
