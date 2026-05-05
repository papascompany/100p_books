"use client";

import type { CSSProperties } from "react";

import type {
  ClipartObject,
  LayoutObject,
  PageDoc,
  PhotoObject,
  RectObject,
  TextObject,
} from "@/lib/layout/types";

export interface PagePreviewProps {
  doc: PageDoc;
  photoUrls: Record<string, string>;
  /** 카드 폭(px). 내부에서 mm→px 스케일 계산. */
  cardWidthPx: number;
  /** 안전선(bleed 경계) 점선 표시. */
  showSafeLine?: boolean;
}

/**
 * HTML/CSS 로 PageDoc 근사 렌더.
 * Fabric 없이 빠르게 썸네일 품질의 프리뷰를 보여준다.
 *
 * 스케일:
 *   scale = cardWidthPx / doc.widthMm  (mm → px)
 *   각 오브젝트 left/top/w/h 를 mm * scale 로 변환.
 *   fontSize: pt * scale (1mm ≈ 2.8346pt 지만 UI 에선 pt * scale 로 근사, 디자인 용도).
 */
export default function PagePreview({
  doc,
  photoUrls,
  cardWidthPx,
  showSafeLine = false,
}: PagePreviewProps) {
  const scale = cardWidthPx / doc.widthMm;
  const cardHeightPx = doc.heightMm * scale;

  return (
    <div
      role="img"
      aria-label={`페이지 ${doc.pageNo} 프리뷰`}
      className="relative overflow-hidden rounded-md ring-1 ring-black/5"
      style={{
        width: cardWidthPx,
        height: cardHeightPx,
        backgroundColor: doc.backgroundColor,
      }}
    >
      {doc.objects.map((obj) => renderObject(obj, scale, photoUrls))}

      {showSafeLine ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            margin: doc.bleedMm * scale,
            border: "1px dashed rgba(0, 0, 0, 0.2)",
          }}
        />
      ) : null}
    </div>
  );
}

function renderObject(
  obj: LayoutObject,
  scale: number,
  photoUrls: Record<string, string>,
) {
  if (obj.type === "photo") return renderPhoto(obj, scale, photoUrls);
  if (obj.type === "text") return renderText(obj, scale);
  if (obj.type === "clipart") return renderClipart(obj, scale);
  return renderRect(obj, scale);
}

function baseBoxStyle(
  obj: { leftMm: number; topMm: number; widthMm: number; heightMm: number },
  scale: number,
): CSSProperties {
  return {
    position: "absolute",
    left: obj.leftMm * scale,
    top: obj.topMm * scale,
    width: obj.widthMm * scale,
    height: obj.heightMm * scale,
  };
}

function renderPhoto(
  obj: PhotoObject,
  scale: number,
  photoUrls: Record<string, string>,
) {
  const src = photoUrls[obj.photoId];
  const style: CSSProperties = {
    ...baseBoxStyle(obj, scale),
    transform: obj.rotation ? `rotate(${obj.rotation}deg)` : undefined,
    transformOrigin: "center",
    borderRadius: obj.borderRadiusMm ? obj.borderRadiusMm * scale : undefined,
    overflow: "hidden",
    boxShadow: obj.shadow
      ? `0 ${obj.shadow.offsetYMm * scale}px ${obj.shadow.blurMm * scale}px ${obj.shadow.color}`
      : undefined,
    backgroundColor: "#eceae5",
  };

  return (
    <div key={obj.objectId} style={style}>
      {src ? (
        // next/image 대신 img — signedUrl 이 짧은 TTL, 캐시 프리로드 불필요
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: obj.cropMode === "contain" ? "contain" : "cover",
            display: "block",
          }}
        />
      ) : null}
    </div>
  );
}

function renderText(obj: TextObject, scale: number) {
  const isEmpty = obj.text.trim().length === 0;
  const display = isEmpty ? obj.placeholder ?? "" : obj.text;
  const style: CSSProperties = {
    ...baseBoxStyle(obj, scale),
    color: isEmpty ? "rgba(0,0,0,0.35)" : obj.fill,
    fontFamily: `${obj.fontFamily}, "Pretendard", system-ui, sans-serif`,
    fontSize: obj.fontSizePt * scale,
    lineHeight: obj.lineHeight,
    textAlign: obj.align,
    fontStyle: obj.italic ? "italic" : undefined,
    fontWeight: obj.bold ? 600 : undefined,
    display: "flex",
    alignItems: "center",
    justifyContent:
      obj.align === "center"
        ? "center"
        : obj.align === "right"
          ? "flex-end"
          : "flex-start",
    overflow: "hidden",
    whiteSpace: "pre-wrap",
    wordBreak: "keep-all",
    padding: 0,
  };
  return (
    <div key={obj.objectId} style={style}>
      <span style={{ display: "block", width: "100%" }}>{display}</span>
    </div>
  );
}

function renderClipart(obj: ClipartObject, scale: number) {
  const style: CSSProperties = {
    ...baseBoxStyle(obj, scale),
    transform: obj.rotation ? `rotate(${obj.rotation}deg)` : undefined,
    transformOrigin: "center",
    opacity: obj.opacity ?? 1,
    overflow: "hidden",
  };
  return (
    <div key={obj.objectId} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={obj.src}
        alt=""
        loading="lazy"
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
    </div>
  );
}

function renderRect(obj: RectObject, scale: number) {
  const style: CSSProperties = {
    ...baseBoxStyle(obj, scale),
    backgroundColor: obj.fill,
    borderRadius: obj.borderRadiusMm ? obj.borderRadiusMm * scale : undefined,
    transform: obj.rotation ? `rotate(${obj.rotation}deg)` : undefined,
    transformOrigin: "center",
    // 빈 슬롯 자리표시자는 살짝 점선 테두리로 구분
    outline: obj.placeholderSlot ? "1px dashed rgba(0,0,0,0.15)" : undefined,
    outlineOffset: "-2px",
  };
  return <div key={obj.objectId} aria-hidden style={style} />;
}
