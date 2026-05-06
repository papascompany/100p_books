"use client";

import * as DialogPrimitives from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitives.Root;
const DialogTrigger = DialogPrimitives.Trigger;
const DialogPortal = DialogPrimitives.Portal;
const DialogClose = DialogPrimitives.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitives.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitives.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitives.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
      "data-[state=open]:animate-fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitives.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitives.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitives.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitives.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
        "w-full max-w-lg max-h-[90dvh] overflow-y-auto",
        "rounded-2xl border bg-background shadow-soft-lg",
        "p-6 focus:outline-none",
        "data-[state=open]:animate-fade-in",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitives.Close
        className={cn(
          "absolute right-4 top-4 rounded-md p-1 text-muted-foreground",
          "transition-colors hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label="닫기"
      >
        <X className="h-4 w-4" />
      </DialogPrimitives.Close>
    </DialogPrimitives.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitives.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 text-left", className)}
      {...props}
    />
  );
}
DialogHeader.displayName = "DialogHeader";

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitives.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitives.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-tight tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitives.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitives.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitives.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitives.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
