"use client";

import * as React from "react";
import { create } from "zustand";

import type { ToastVariant } from "./toast";

/**
 * shadcn 표준 useToast 훅 (Zustand 기반 단일 스토어).
 *
 * - max 3 동시 표시
 * - default/success/warning 5초, destructive 7초 자동 해제
 * - `toast()` 호출 시 동일 id 가 있으면 update, 없으면 insert
 * - 닫힘은 두 단계: `dismiss()` → open=false (애니메이션) → REMOVE_DELAY 후 list 에서 제거
 */

const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 1000; // 닫힘 애니메이션 시간

const DURATION_BY_VARIANT: Record<ToastVariant, number> = {
  default: 5000,
  success: 5000,
  warning: 5000,
  destructive: 7000,
};

export interface ToasterToast {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  variant?: ToastVariant;
  open: boolean;
  duration?: number;
  onOpenChange?: (open: boolean) => void;
}

interface ToastStore {
  toasts: ToasterToast[];
  add: (toast: ToasterToast) => void;
  update: (toast: Partial<ToasterToast> & { id: string }) => void;
  dismiss: (id?: string) => void;
  remove: (id?: string) => void;
}

const useStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) =>
    set((state) => ({
      toasts: [toast, ...state.toasts].slice(0, TOAST_LIMIT),
    })),
  update: (toast) =>
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === toast.id ? { ...t, ...toast } : t,
      ),
    })),
  dismiss: (id) =>
    set((state) => ({
      toasts: state.toasts.map((t) =>
        id === undefined || t.id === id ? { ...t, open: false } : t,
      ),
    })),
  remove: (id) =>
    set((state) => ({
      toasts:
        id === undefined ? [] : state.toasts.filter((t) => t.id !== id),
    })),
}));

let idCounter = 0;
function genId() {
  idCounter = (idCounter + 1) % Number.MAX_SAFE_INTEGER;
  return String(idCounter);
}

const removeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleRemove(id: string) {
  if (removeTimers.has(id)) return;
  const timer = setTimeout(() => {
    removeTimers.delete(id);
    useStore.getState().remove(id);
  }, TOAST_REMOVE_DELAY);
  removeTimers.set(id, timer);
}

export interface ToastInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

export interface ToastReturn {
  id: string;
  dismiss: () => void;
  update: (props: ToastInput) => void;
}

export function toast(props: ToastInput): ToastReturn {
  const id = genId();
  const variant = props.variant ?? "default";
  const duration = props.duration ?? DURATION_BY_VARIANT[variant];

  const dismissThis = () => {
    useStore.getState().dismiss(id);
    scheduleRemove(id);
  };

  useStore.getState().add({
    id,
    title: props.title,
    description: props.description,
    action: props.action,
    variant,
    duration,
    open: true,
    onOpenChange: (open) => {
      if (!open) {
        useStore.getState().dismiss(id);
        scheduleRemove(id);
      }
    },
  });

  return {
    id,
    dismiss: dismissThis,
    update: (next) => useStore.getState().update({ id, ...next }),
  };
}

export function useToast(): {
  toasts: ToasterToast[];
  toast: typeof toast;
  dismiss: (id?: string) => void;
} {
  const toasts = useStore((s) => s.toasts);
  const dismiss = React.useCallback((id?: string) => {
    useStore.getState().dismiss(id);
    if (id) scheduleRemove(id);
    else {
      useStore.getState().toasts.forEach((t) => scheduleRemove(t.id));
    }
  }, []);
  return { toasts, toast, dismiss };
}
