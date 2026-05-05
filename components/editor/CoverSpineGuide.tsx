"use client";

import type { CoverDimensions } from "@/lib/layout/cover";

export interface CoverSpineGuideProps {
  dims: CoverDimensions;
  /** 페이지 수 — 책등 라벨에 표시. */
  pageCount: number;
  /** 가이드를 보일지. */
  visible?: boolean;
}

/**
 * FabricStage 위에 absolute 로 얹는 가이드 오버레이.
 *   - 뒤표지 / 책등 / 앞표지 영역 라벨 (반투명).
 *   - 책등 점선 + 두께 표시.
 *
 * 이 컴포넌트는 부모가 캔버스와 같은 박스 안에 position: relative 로 배치하고,
 * width 100% / height 100% 를 차지하도록 한다.
 *
 * 좌표는 비율 기반 (totalWidthMm) → CSS percentage 로 표현하므로
 * 실제 캔버스 줌/스케일에 자동 따라간다.
 */
export default function CoverSpineGuide({
  dims,
  pageCount,
  visible = true,
}: CoverSpineGuideProps) {
  if (!visible) return null;
  const total = dims.totalWidthMm;
  if (total <= 0) return null;
  const backPct = (dims.bookWidthMm / total) * 100;
  const spinePct = (dims.spineMm / total) * 100;
  const frontPct = (dims.bookWidthMm / total) * 100;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      aria-hidden="true"
    >
      {/* 뒤표지 라벨 */}
      <div
        className="absolute top-2 flex items-center justify-center text-[10px] font-medium uppercase tracking-widest text-rose-600/70"
        style={{ left: 0, width: `${backPct}%` }}
      >
        <span className="rounded-full bg-white/80 px-2 py-0.5">뒤표지</span>
      </div>

      {/* 책등 — 점선 박스 + 라벨 */}
      {spinePct > 0 ? (
        <>
          <div
            className="absolute top-0 bottom-0 border-l border-r border-dashed border-rose-500/40"
            style={{
              left: `${backPct}%`,
              width: `${spinePct}%`,
            }}
          />
          <div
            className="absolute bottom-2 flex items-center justify-center text-[10px] font-medium text-rose-600/80"
            style={{
              left: `${backPct}%`,
              width: `${spinePct}%`,
            }}
          >
            <span className="whitespace-nowrap rounded-full bg-white/80 px-2 py-0.5">
              책등 {dims.spineMm.toFixed(2)}mm · {pageCount}p
            </span>
          </div>
        </>
      ) : null}

      {/* 앞표지 라벨 */}
      <div
        className="absolute top-2 flex items-center justify-center text-[10px] font-medium uppercase tracking-widest text-rose-600/70"
        style={{ left: `${backPct + spinePct}%`, width: `${frontPct}%` }}
      >
        <span className="rounded-full bg-white/80 px-2 py-0.5">앞표지</span>
      </div>
    </div>
  );
}
