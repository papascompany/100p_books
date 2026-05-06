import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "text-base font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    /* Nike: all buttons are pill-shaped */
    "rounded-full",
  ].join(" "),
  {
    variants: {
      variant: {
        /* Nike button-primary: black pill */
        default:
          "bg-[#111111] text-white hover:bg-[#111111]/90 active:scale-[0.98] active:opacity-90",
        /* Nike button-secondary: soft-cloud pill */
        secondary:
          "bg-[#f5f5f5] text-[#111111] hover:bg-[#e5e5e5] active:scale-[0.98]",
        /* Nike button-outline-on-image: white pill on photos */
        outline:
          "bg-white text-[#111111] border border-[#cacacb] hover:border-[#111111] active:scale-[0.98]",
        /* Destructive: sale red pill */
        destructive:
          "bg-[#d30005] text-white hover:bg-[#d30005]/90 active:scale-[0.98]",
        /* Ghost: no background, ink text */
        ghost: "hover:bg-[#f5f5f5] text-[#111111] active:scale-[0.98]",
        /* Link: underline only */
        link: "text-[#111111] underline-offset-4 hover:underline p-0 h-auto",
        /* Legacy gradient → now maps to primary black pill */
        gradient:
          "bg-[#111111] text-white hover:bg-[#111111]/90 active:scale-[0.98] active:opacity-90",
      },
      size: {
        /* Nike standard: h-12 = 48px */
        default: "h-12 px-8 text-base",
        sm: "h-10 px-6 text-sm",
        lg: "h-12 px-8 text-base",
        /* Icon button: 40px circular */
        icon: "h-10 w-10 bg-[#f5f5f5] text-[#111111]",
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
