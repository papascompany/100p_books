"use client";

import { Box, ImageOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ORDER_PREVIEW_THUMB_HEIGHT_PX,
  thumbWidthPx,
  type OrderPreviewPage,
} from "./order-preview";
import PagePreview from "@/app/(user)/editor/[projectId]/PagePreview";
import Cover3DPreview from "@/components/editor/Cover3DPreview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface OrderPreviewCoverInfo {
  /** 펼친 표지 렌더 PNG 의 가로/세로 비율 — bleed 포함(placeholder 크기 고정용). */
  aspectRatio: number;
  /** Cover3DPreview 입력 — calcCoverDimensions 결과. */
  bookWidthMm: number;
  bookHeightMm: number;
  spineMm: number;
}

export interface OrderPreviewCardProps {
  projectId: string;
  pageCount: number;
  cover: OrderPreviewCoverInfo;
  /** 내지 앞쪽 몇 장 (page_no 오름차순). */
  pages: OrderPreviewPage[];
  /** photoId → thumb signed URL. 누락 사진은 회색 칸으로 남는다. */
  photoUrls: Record<string, string>;
}

type CoverState =
  | { status: "loading" }
  | { status: "ready"; png: string }
  | { status: "error" };

const THUMB_H = ORDER_PREVIEW_THUMB_HEIGHT_PX;

/**
 * 주문서 "인쇄 전 확인" 카드 — 결제 직전에 표지·내지를 눈으로 한 번 더 확인시킨다.
 *
 *   - 표지: 표지 편집기 3D 미리보기와 같은 POST /api/cover/preview(72dpi PNG dataURL)를
 *     마운트 시 한 번 호출해 썸네일과 3D 미리보기에 함께 쓴다.
 *   - 내지: 서버에서 받은 앞쪽 PageDoc 을 내지 편집 그리드의 PagePreview(HTML/CSS 근사)로 그린다.
 *   - 어떤 이미지가 실패해도 회색 칸으로 두고 주문 진행은 막지 않는다(체크박스 없음).
 */
export default function OrderPreviewCard({
  projectId,
  pageCount,
  cover,
  pages,
  photoUrls,
}: OrderPreviewCardProps) {
  const [coverState, setCoverState] = useState<CoverState>({ status: "loading" });
  const [open3d, setOpen3d] = useState(false);

  // 표지 미리보기 PNG — state 반영은 promise 콜백에서만(react-hooks/set-state-in-effect).
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const res = await fetch(`/api/cover/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
        signal: ac.signal,
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { pngDataUrl: string };
      };
      if (!res.ok || !json.ok || !json.data?.pngDataUrl) {
        throw new Error("cover preview failed");
      }
      return json.data.pngDataUrl;
    })()
      .then((png) => {
        setCoverState({ status: "ready", png });
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === "AbortError") return;
        setCoverState({ status: "error" });
      });
    return () => ac.abort();
  }, [projectId]);

  const coverW = thumbWidthPx(cover.aspectRatio, 1, THUMB_H);
  const remaining = Math.max(0, pageCount - pages.length);

  return (
    <section
      aria-labelledby="order-preview-title"
      className="rounded-2xl border border-hairline bg-card p-4 shadow-soft sm:p-5"
    >
      <h2 id="order-preview-title" className="text-sm font-semibold">
        인쇄 전 확인
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        인쇄된 책은 단순 변심으로 환불할 수 없어요. 표지와 페이지를 한 번 더 확인해 주세요.
      </p>

      <ul
        aria-label="표지와 앞쪽 페이지 미리보기"
        className="mt-3 flex gap-3 overflow-x-auto pb-2"
      >
        <li className="shrink-0">
          <figure>
            <div
              className="overflow-hidden rounded-md bg-muted ring-1 ring-black/5"
              style={{ width: coverW, height: THUMB_H }}
            >
              {coverState.status === "ready" ? (
                // dataURL — next/image 최적화 대상 아님
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverState.png}
                  alt="펼친 표지 미리보기"
                  className="block h-full w-full object-cover"
                  draggable={false}
                  onError={() => setCoverState({ status: "error" })}
                />
              ) : coverState.status === "error" ? (
                <div
                  role="img"
                  aria-label="표지 미리보기를 불러오지 못했어요"
                  className="flex h-full w-full items-center justify-center text-muted-foreground"
                >
                  <ImageOff className="size-5" aria-hidden />
                </div>
              ) : (
                <div
                  role="status"
                  aria-label="표지 미리보기를 불러오는 중"
                  className="h-full w-full animate-pulse motion-reduce:animate-none"
                />
              )}
            </div>
            <figcaption className="mt-1 text-xs text-muted-foreground">표지</figcaption>
          </figure>
        </li>

        {pages.map((p) => (
          <li key={p.id} className="shrink-0">
            <figure>
              <div className="bg-muted" style={{ height: THUMB_H }}>
                <PagePreview
                  doc={p.doc}
                  photoUrls={photoUrls}
                  cardWidthPx={thumbWidthPx(p.doc.widthMm, p.doc.heightMm, THUMB_H)}
                />
              </div>
              <figcaption className="mt-1 text-xs text-muted-foreground">
                {p.pageNo}p
              </figcaption>
            </figure>
          </li>
        ))}

        {remaining > 0 ? (
          <li className="shrink-0">
            <div
              className="flex items-center justify-center rounded-md border border-dashed border-hairline px-3 text-center text-xs text-muted-foreground"
              style={{ height: THUMB_H }}
            >
              외 {remaining}페이지
            </div>
          </li>
        ) : null}
      </ul>

      {/* 390px 에서도 한 줄 — 모바일은 버튼 좌우 여백을 줄인다(예전엔 "내지 수정" 만 다음 줄로 떨어졌다). */}
      <div className="mt-2 flex items-center gap-1 md:gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="px-3 md:px-6"
          onClick={() => setOpen3d(true)}
          disabled={coverState.status !== "ready"}
        >
          <Box aria-hidden />
          3D 미리보기
        </Button>
        <Button asChild size="sm" variant="ghost" className="px-3 md:px-6">
          <Link href={`/cover/${projectId}`}>표지 수정</Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="px-3 md:px-6">
          <Link href={`/editor/${projectId}`}>내지 수정</Link>
        </Button>
      </div>

      <Dialog open={open3d} onOpenChange={setOpen3d}>
        <DialogContent className="w-[min(94vw,720px)] max-w-none">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base">표지 3D 미리보기</DialogTitle>
            <DialogDescription>
              실제 인쇄/제본 후의 입체 형태를 근사로 보여줘요.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 flex min-h-[320px] items-center justify-center overflow-hidden rounded-lg bg-muted/40">
            {coverState.status === "ready" ? (
              <Cover3DPreview
                coverPng={coverState.png}
                bookWidthMm={cover.bookWidthMm}
                bookHeightMm={cover.bookHeightMm}
                spineMm={cover.spineMm}
                pageCount={pageCount}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
