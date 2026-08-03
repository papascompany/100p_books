"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * 표지 3D 미리보기 (CSS 3D transform 기반).
 *
 * 동작:
 *   - 서버에서 렌더된 표지 PNG(coverPng — base64 dataURL 또는 signedUrl) 를 펼친 한 장으로 받아,
 *     CSS background-position 으로 "앞표지/책등/뒷표지" 세 면을 분리해 입체로 배치한다.
 *   - 펼친 표지 폭 = bookWidthMm + spineMm + bookWidthMm (앞 + 책등 + 뒤).
 *   - 각 면의 배경 위치는 px 단위로 `widthMm` 비율 기반으로 계산.
 *   - 카드 컨테이너는 perspective(1200px) + rotateY 로 사선 시점.
 *   - 드래그(포인터/터치)로 rotateY 를 조절한다 — 모바일 퍼스트.
 *
 * 반응형:
 *   - 부모 컨테이너 폭을 ResizeObserver 로 측정해 displayHeight 를 역산 —
 *     소형 뷰포트에서 다이얼로그 밖으로 넘치지 않는다.
 *
 * 접근성:
 *   - aria-hidden — 시각적 미리보기 전용. 정확한 정보는 펼친 표지 캔버스에 있음.
 *
 * 성능:
 *   - 단일 이미지 + transform — GPU 합성으로 60fps 유지.
 *   - prefers-reduced-motion 사용자에겐 회전 애니메이션 비활성.
 */

export interface Cover3DPreviewProps {
  /** 펼친 표지 PNG (base64 dataURL 또는 signed URL). 없으면 단색 더미. */
  coverPng?: string;
  /** 한 권 폭 (mm). */
  bookWidthMm: number;
  bookHeightMm: number;
  spineMm: number;
  pageCount: number;
  /** 뷰포트 표시 높이 상한 (px). 기본 320 — 컨테이너 폭이 좁으면 자동 축소. */
  displayHeightPx?: number;
  /** 클래스 오버라이드. */
  className?: string;
}

const ROTATE_Y_DEFAULT = -25;
const ROTATE_Y_MIN = -70;
const ROTATE_Y_MAX = 20;
const DRAG_DEG_PER_PX = 0.35;
const MIN_HEIGHT_PX = 120;

export default function Cover3DPreview({
  coverPng,
  bookWidthMm,
  bookHeightMm,
  spineMm,
  pageCount,
  displayHeightPx = 320,
  className,
}: Cover3DPreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState<number | null>(null);
  const [rotateY, setRotateY] = useState(ROTATE_Y_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startRot: number;
  } | null>(null);

  // 컨테이너 폭 측정 — 소형 뷰포트에서 프리뷰가 넘치지 않도록 높이 역산.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setBoxWidth(el.clientWidth);
    const ro = new ResizeObserver(() => {
      setBoxWidth(el.clientWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const safeBookHeightMm = Math.max(bookHeightMm, 1);
  // 루트 폭 ≈ (bookWidthMm + spineMm) × scale + 40 → 폭 제약으로부터 높이 역산.
  let heightPx = displayHeightPx;
  if (boxWidth !== null && boxWidth > 0) {
    const widthConstrained =
      ((boxWidth - 40) * safeBookHeightMm) /
      Math.max(bookWidthMm + spineMm, 1);
    heightPx = Math.max(
      MIN_HEIGHT_PX,
      Math.min(displayHeightPx, widthConstrained),
    );
  }

  // 표시 스케일: bookHeightMm → heightPx
  const scale = heightPx / safeBookHeightMm;
  const frontPx = bookWidthMm * scale;
  const spinePx = Math.max(2, spineMm * scale); // 너무 얇아서 안 보이지 않게 최소 2px
  const totalPngWidthPx = (bookWidthMm * 2 + spineMm) * scale;

  // 펼친 PNG 좌표 (좌→우): 뒷표지(0..bookWidth) | 책등(bookWidth..bookWidth+spine) | 앞표지(...)
  const backOffsetX = 0;
  const spineOffsetX = bookWidthMm * scale;
  const frontOffsetX = (bookWidthMm + spineMm) * scale;

  const bgImage = coverPng ? `url("${coverPng}")` : undefined;
  const bgFallback = coverPng ? "transparent" : "#e6e2db";

  const rotateX = -3;

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startRot: rotateY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const next = Math.min(
      ROTATE_Y_MAX,
      Math.max(ROTATE_Y_MIN, d.startRot + (e.clientX - d.startX) * DRAG_DEG_PER_PX),
    );
    setRotateY(next);
  }

  function onPointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }

  return (
    <div
      ref={boxRef}
      className={"w-full " + (className ?? "")}
      aria-hidden="true"
    >
      <div
        className="relative mx-auto select-none"
        style={{
          width: frontPx + spinePx + 40,
          height: heightPx + 80,
          perspective: "1200px",
        }}
      >
        <div
          className={
            "absolute left-1/2 top-1/2 cursor-grab touch-none motion-reduce:transition-none " +
            (dragging
              ? "cursor-grabbing"
              : "transition-transform duration-300 ease-out")
          }
          style={{
            transformStyle: "preserve-3d",
            transform: `translate(-50%, -50%) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
            width: frontPx,
            height: heightPx,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {/* 앞표지 — 정면 (z = +spinePx/2) */}
          <div
            className="absolute inset-0 rounded-r-[2px] bg-card shadow-[0_8px_20px_rgba(0,0,0,0.18)]"
            style={{
              transform: `translateZ(${spinePx / 2}px)`,
              backgroundColor: bgFallback,
              backgroundImage: bgImage,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${totalPngWidthPx}px ${heightPx}px`,
              backgroundPosition: `-${frontOffsetX}px 0`,
            }}
          />

          {/* 뒷표지 — 뒷면 (z = -spinePx/2, 180도 뒤집힘) */}
          <div
            className="absolute inset-0 rounded-l-[2px] bg-card"
            style={{
              transform: `translateZ(-${spinePx / 2}px) rotateY(180deg)`,
              backgroundColor: bgFallback,
              backgroundImage: bgImage,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${totalPngWidthPx}px ${heightPx}px`,
              // 뒷면은 180도 뒤집혀 있어 좌우 반전된 뒷표지 영역이 보이도록 PNG 의 뒷표지 영역(=좌측 0~bookWidth)을 그대로 배치.
              backgroundPosition: `-${backOffsetX}px 0`,
            }}
          />

          {/* 책등 — 좌측 면 (앞표지 좌단에 직각으로 붙임) */}
          <div
            className="absolute top-0 bottom-0 bg-card"
            style={{
              left: 0,
              width: spinePx,
              transform: `translateZ(${spinePx / 2}px) rotateY(-90deg)`,
              transformOrigin: "left center",
              backgroundColor: bgFallback,
              backgroundImage: bgImage,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${totalPngWidthPx}px ${heightPx}px`,
              backgroundPosition: `-${spineOffsetX}px 0`,
            }}
          />

          {/* 윗면(상단 단면) — 종이 더미 표현 */}
          <div
            className="absolute"
            style={{
              top: 0,
              left: 0,
              right: 0,
              height: spinePx,
              transform: `translateZ(${spinePx / 2}px) rotateX(90deg)`,
              transformOrigin: "top center",
              background:
                "repeating-linear-gradient(180deg, #f6f1e8 0px, #f6f1e8 1px, #ddd5c4 1px, #ddd5c4 2px)",
            }}
          />

          {/* 하단 단면 */}
          <div
            className="absolute"
            style={{
              bottom: 0,
              left: 0,
              right: 0,
              height: spinePx,
              transform: `translateZ(${spinePx / 2}px) rotateX(-90deg)`,
              transformOrigin: "bottom center",
              background:
                "repeating-linear-gradient(180deg, #f6f1e8 0px, #f6f1e8 1px, #ddd5c4 1px, #ddd5c4 2px)",
            }}
          />
        </div>

        {/* 그림자 — 책 아래 */}
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-[50%] blur-md transition-opacity duration-300 motion-reduce:transition-none"
          style={{
            bottom: 24,
            width: frontPx * 0.95,
            height: 14,
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0) 70%)",
            opacity: dragging ? 0.9 : 0.7,
          }}
        />

        {/* 메타 정보 */}
        <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-card/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          책등 {spineMm.toFixed(2)}mm · {pageCount}p · 드래그로 돌려보세요
        </div>
      </div>
    </div>
  );
}
