import { cn } from "@/lib/utils";

/** 포토북 제작 흐름의 단계 — 화면마다 표기가 달랐던 것을 한 곳에서 통일한다. */
export const FLOW_STEPS = ["사진 올리기", "내지 편집", "표지 만들기", "주문하기"] as const;

export type FlowStep = 1 | 2 | 3 | 4;

interface StepIndicatorProps {
  step: FlowStep;
  className?: string;
}

/** "1/4 · 사진 올리기" 형식의 간단한 단계 표시. */
export default function StepIndicator({ step, className }: StepIndicatorProps) {
  const total = FLOW_STEPS.length;
  const name = FLOW_STEPS[step - 1];
  return (
    <p className={cn("text-xs font-medium tracking-[0.12em] text-coral/90", className)}>
      <span className="sr-only">
        {total}단계 중 {step}단계, {name}
      </span>
      <span aria-hidden>
        {step}/{total} · {name}
      </span>
    </p>
  );
}
