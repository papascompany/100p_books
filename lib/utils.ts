import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind 클래스 병합 헬퍼.
 * - clsx: 조건부 class 조합
 * - tailwind-merge: 충돌(예: px-2 / px-4)을 후자 우선으로 병합
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
