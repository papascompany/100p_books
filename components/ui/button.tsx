import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "text-base font-semibold transition-all duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    /* 모던 캐주얼: pill 형태 유지 */
    "rounded-full",
  ].join(" "),
  {
    variants: {
      variant: {
        /* 기본: 모노 pill (전경/배경 시맨틱 — 다크 자동 반전) */
        default:
          "bg-foreground text-background shadow-soft hover:shadow-soft-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
        /* 포인트 CTA: 코랄 pill (주요 행동 유도) */
        coral:
          "bg-coral text-white shadow-soft hover:bg-coral-600 hover:shadow-coral-glow hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
        /* 보조: soft pill */
        secondary:
          "bg-soft-cloud text-ink hover:bg-[#e7e7ea] active:scale-[0.98]",
        /* 아웃라인 (표면 배경) */
        outline:
          "bg-card text-ink border border-hairline shadow-soft hover:border-ink hover:shadow-soft-lg active:scale-[0.98]",
        /* 코랄 아웃라인 — 가벼운 강조 */
        "coral-outline":
          "bg-coral-50 text-coral-700 border border-coral-200 hover:bg-coral-100 hover:border-coral-300 active:scale-[0.98]",
        /* 위험 */
        destructive:
          "bg-[#d30005] text-white shadow-soft hover:bg-[#d30005]/90 active:scale-[0.98]",
        /* 고스트 */
        ghost: "hover:bg-soft-cloud text-ink active:scale-[0.98]",
        /* 링크 */
        link: "text-coral-600 underline-offset-4 hover:underline p-0 h-auto",
        /* legacy gradient → 코랄로 매핑 */
        gradient:
          "bg-coral text-white shadow-soft hover:bg-coral-600 hover:shadow-coral-glow hover:-translate-y-0.5 active:scale-[0.98]",
      },
      size: {
        default: "h-12 px-8 text-base",
        sm: "h-10 px-6 text-sm",
        lg: "h-14 px-10 text-base",
        icon: "h-10 w-10 bg-soft-cloud text-ink",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
