"use client";

import * as fabric from "fabric";
import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ptToPx, type TaggedFabricObject } from "@/lib/fabric/serialize";

import type { SetBackgroundInput } from "./FabricStage";

export interface CanvasBackgroundOption {
  /** 단색 적용 — color picker. */
  onColor?: (color: string) => void;
  /** 사진 그리드 열기. 호출자가 photoId 를 골라 setBackground 호출. */
  onPickPhoto?: () => void;
  /** 리소스 카탈로그 열기. */
  onPickResource?: () => void;
  /** 배경 제거. */
  onClear?: () => void;
  /** 현재 배경색 (color picker 기본값). */
  currentColor?: string;
}

export interface SelectionPanelProps {
  selection: TaggedFabricObject | null;
  /** 현재 캔버스 DPI (pt ↔ px 변환에 사용). */
  dpi: number;
  /** 변경 발생 시 강제 push (debounce 와 무관) — 자동 저장 트리거. */
  onChange?: () => void;
  /**
   * 선택 객체가 없을 때 노출되는 "캔버스 배경" 섹션 핸들러.
   * 미지정 시 빈 안내 문구만 표시.
   */
  background?: CanvasBackgroundOption;
  /**
   * 선택 객체가 photo 일 때 노출되는 "사진 교체" 버튼 클릭 핸들러.
   * 미지정 시 버튼은 표시되지 않음.
   */
  onReplacePhoto?: () => void;
}

/** SelectionPanel 외부에서 setBackground 시 사용할 헬퍼 (입력 매핑 단순화). */
export type { SetBackgroundInput };

/**
 * 선택 객체에 따라 다른 속성 편집 UI.
 *  - 텍스트: family/size/color/align/bold/italic/lineHeight
 *  - 이미지: cropMode/rotation/opacity/borderRadiusMm
 *  - 도형:   fill/stroke
 *
 * 텍스트 폰트 변경은 ResourcePalette 에서도 가능 — 여기선 시스템 폰트만 빠른 토글.
 */
export default function SelectionPanel({
  selection,
  dpi,
  onChange,
  background,
  onReplacePhoto,
}: SelectionPanelProps) {
  if (!selection) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-dashed bg-white/40 p-4 text-sm text-muted-foreground">
          편집할 객체를 선택하세요.
        </div>
        {background ? <CanvasBackgroundSection {...background} /> : null}
      </div>
    );
  }

  if (selection.oType === "text") {
    return (
      <TextEditor
        target={selection as fabric.Textbox & TaggedFabricObject}
        dpi={dpi}
        onChange={onChange}
      />
    );
  }
  if (selection.oType === "photo") {
    return (
      <PhotoEditor
        target={selection as fabric.FabricImage & TaggedFabricObject}
        onChange={onChange}
        onReplacePhoto={onReplacePhoto}
      />
    );
  }
  if (selection.oType === "rect") {
    return (
      <RectEditor
        target={selection as fabric.Rect & TaggedFabricObject}
        onChange={onChange}
      />
    );
  }
  return null;
}

function CanvasBackgroundSection({
  onColor,
  onPickPhoto,
  onPickResource,
  onClear,
  currentColor,
}: CanvasBackgroundOption) {
  return (
    <section className="rounded-md border bg-white/60 p-3">
      <h3 className="mb-2 text-sm font-semibold">캔버스 배경</h3>
      <div className="space-y-2">
        {onColor ? (
          <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>단색</span>
            <Input
              type="color"
              value={currentColor ?? "#ffffff"}
              onChange={(e) => onColor(e.target.value)}
              className="h-8 w-16 p-0"
            />
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {onPickPhoto ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onPickPhoto}
            >
              사진에서 선택
            </Button>
          ) : null}
          {onPickResource ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onPickResource}
            >
              배경 카탈로그
            </Button>
          ) : null}
          {onClear ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClear}
            >
              제거
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TextEditor({
  target,
  dpi,
  onChange,
}: {
  target: fabric.Textbox & TaggedFabricObject;
  dpi: number;
  onChange?: () => void;
}) {
  const [, force] = useState(0);
  const update = () => {
    target.canvas?.fire("object:modified", { target });
    target.canvas?.requestRenderAll();
    force((v) => v + 1);
    onChange?.();
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">텍스트</h3>

      <label className="block text-xs text-muted-foreground">
        폰트
        <select
          className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
          value={(target.fontFamily as string) || "Pretendard"}
          onChange={(e) => {
            target.set({ fontFamily: e.target.value });
            update();
          }}
        >
          <option value="Pretendard">Pretendard</option>
          <option value="Playfair Display">Playfair Display</option>
          <option value="serif">Serif</option>
          <option value="sans-serif">Sans-serif</option>
        </select>
      </label>

      <div className="flex gap-2">
        <label className="block flex-1 text-xs text-muted-foreground">
          크기(pt)
          <Input
            type="number"
            min={6}
            max={200}
            value={Math.round(((target.fontSize ?? 14) * 72) / dpi)}
            onChange={(e) => {
              const pt = Number(e.target.value);
              if (!Number.isFinite(pt) || pt <= 0) return;
              target.set({ fontSize: ptToPx(pt, dpi) });
              update();
            }}
          />
        </label>
        <label className="block w-24 text-xs text-muted-foreground">
          색
          <Input
            type="color"
            value={
              typeof target.fill === "string" ? target.fill : "#2b2b2b"
            }
            onChange={(e) => {
              target.set({ fill: e.target.value });
              update();
            }}
          />
        </label>
      </div>

      <div className="flex gap-2">
        {(["left", "center", "right"] as const).map((a) => (
          <Button
            key={a}
            type="button"
            size="sm"
            variant={target.textAlign === a ? "default" : "outline"}
            onClick={() => {
              target.set({ textAlign: a });
              update();
            }}
          >
            {a === "left" ? "왼쪽" : a === "center" ? "가운데" : "오른쪽"}
          </Button>
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={target.fontWeight === 600 ? "default" : "outline"}
          onClick={() => {
            target.set({
              fontWeight: target.fontWeight === 600 ? 400 : 600,
            });
            update();
          }}
        >
          굵게
        </Button>
        <Button
          size="sm"
          variant={target.fontStyle === "italic" ? "default" : "outline"}
          onClick={() => {
            target.set({
              fontStyle: target.fontStyle === "italic" ? "normal" : "italic",
            });
            update();
          }}
        >
          기울임
        </Button>
      </div>

      <label className="block text-xs text-muted-foreground">
        줄 간격 ({(target.lineHeight ?? 1.4).toFixed(2)})
        <input
          type="range"
          min={1}
          max={2}
          step={0.05}
          value={target.lineHeight ?? 1.4}
          onChange={(e) => {
            target.set({ lineHeight: Number(e.target.value) });
            update();
          }}
          className="mt-1 w-full"
        />
      </label>
    </div>
  );
}

function PhotoEditor({
  target,
  onChange,
  onReplacePhoto,
}: {
  target: fabric.FabricImage & TaggedFabricObject;
  onChange?: () => void;
  onReplacePhoto?: () => void;
}) {
  const [, force] = useState(0);
  const update = () => {
    target.canvas?.fire("object:modified", { target });
    target.canvas?.requestRenderAll();
    force((v) => v + 1);
    onChange?.();
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">사진</h3>

      {onReplacePhoto ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full"
          onClick={onReplacePhoto}
        >
          <ImageIcon className="size-4" aria-hidden /> 사진 교체
        </Button>
      ) : null}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={target.cropMode === "cover" ? "default" : "outline"}
          onClick={() => {
            target.cropMode = "cover";
            update();
          }}
        >
          꽉 채우기
        </Button>
        <Button
          size="sm"
          variant={target.cropMode === "contain" ? "default" : "outline"}
          onClick={() => {
            target.cropMode = "contain";
            update();
          }}
        >
          맞춰 넣기
        </Button>
      </div>

      <label className="block text-xs text-muted-foreground">
        회전 ({Math.round(target.angle ?? 0)}°)
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={target.angle ?? 0}
          onChange={(e) => {
            target.set({ angle: Number(e.target.value) });
            update();
          }}
          className="mt-1 w-full"
        />
      </label>

      <label className="block text-xs text-muted-foreground">
        투명도 ({Math.round((target.opacity ?? 1) * 100)}%)
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={target.opacity ?? 1}
          onChange={(e) => {
            target.set({ opacity: Number(e.target.value) });
            update();
          }}
          className="mt-1 w-full"
        />
      </label>

      <label className="block text-xs text-muted-foreground">
        둥근 모서리 ({Math.round(target.borderRadiusMm ?? 0)}mm)
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={target.borderRadiusMm ?? 0}
          onChange={(e) => {
            target.borderRadiusMm = Number(e.target.value);
            update();
          }}
          className="mt-1 w-full"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(target.shadow)}
          onChange={(e) => {
            if (e.target.checked) {
              target.shadow = new fabric.Shadow({
                blur: 8,
                offsetX: 0,
                offsetY: 4,
                color: "rgba(0,0,0,0.15)",
              });
              target.shadowBlurMm = 2;
              target.shadowOffsetYMm = 1;
              target.shadowColor = "rgba(0,0,0,0.15)";
            } else {
              (target as unknown as { shadow: fabric.Shadow | null }).shadow =
                null;
              target.shadowBlurMm = undefined;
              target.shadowOffsetYMm = undefined;
              target.shadowColor = undefined;
            }
            update();
          }}
        />
        그림자
      </label>
    </div>
  );
}

function RectEditor({
  target,
  onChange,
}: {
  target: fabric.Rect & TaggedFabricObject;
  onChange?: () => void;
}) {
  const [, force] = useState(0);
  const update = () => {
    target.canvas?.fire("object:modified", { target });
    target.canvas?.requestRenderAll();
    force((v) => v + 1);
    onChange?.();
  };

  // target 변경 시 강제 리렌더 (참조만 바뀌어도)
  useEffect(() => {
    force((v) => v + 1);
  }, [target]);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">도형</h3>
      <label className="block text-xs text-muted-foreground">
        채움 색
        <Input
          type="color"
          value={typeof target.fill === "string" ? target.fill : "#ffffff"}
          onChange={(e) => {
            target.set({ fill: e.target.value });
            update();
          }}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        테두리 색
        <Input
          type="color"
          value={typeof target.stroke === "string" ? target.stroke : "#000000"}
          onChange={(e) => {
            target.set({ stroke: e.target.value });
            update();
          }}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        테두리 두께 ({target.strokeWidth ?? 0}px)
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={target.strokeWidth ?? 0}
          onChange={(e) => {
            target.set({ strokeWidth: Number(e.target.value) });
            update();
          }}
          className="mt-1 w-full"
        />
      </label>
    </div>
  );
}
