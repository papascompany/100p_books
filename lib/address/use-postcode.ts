"use client";

import * as React from "react";

/**
 * 다음(카카오) 우편번호 SDK 통합 훅.
 *
 * - CDN 스크립트를 idempotent 하게 동적 로드 (한 번만 로드)
 * - `open()` 호출 시 팝업 모달이 뜨고, 사용자가 주소를 선택하면 `oncomplete` 콜백 호출
 * - SSR 안전: `typeof window` 가드, 콜백은 클라에서만 동작
 *
 * 모바일 popup 차단 환경 fallback 은 후속 단계.
 */

const SDK_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

export interface PostcodeResult {
  zonecode: string;
  address: string;
  /** "R" = 도로명 / "J" = 지번 */
  addressType: "R" | "J";
}

/** 다음 우편번호 SDK 가 노출하는 전역 타입 (서브셋). */
interface DaumPostcodeRaw {
  zonecode?: string;
  address?: string;
  roadAddress?: string;
  jibunAddress?: string;
  addressType?: string;
  userSelectedType?: string;
}

interface DaumPostcodeOptions {
  oncomplete: (data: DaumPostcodeRaw) => void;
  width?: string | number;
  height?: string | number;
}

interface DaumPostcodeInstance {
  open: () => void;
  embed?: (el: HTMLElement) => void;
}

interface DaumGlobal {
  Postcode: new (options: DaumPostcodeOptions) => DaumPostcodeInstance;
}

declare global {
  interface Window {
    daum?: DaumGlobal;
  }
}

let loadPromise: Promise<void> | null = null;

function ensureSdkLoaded(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("브라우저 환경이 아닙니다."));
  }
  if (window.daum?.Postcode) {
    return Promise.resolve();
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    // 이미 로드된 스크립트 태그 재사용
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-daum-postcode]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("우편번호 SDK 로드 실패")),
        { once: true },
      );
      // 이미 완료된 스크립트라면 다음 tick 에 daum 객체가 있을 수 있음
      if (window.daum?.Postcode) resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.daumPostcode = "1";
    script.addEventListener(
      "load",
      () => {
        if (window.daum?.Postcode) resolve();
        else reject(new Error("우편번호 SDK 초기화 실패"));
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => reject(new Error("우편번호 SDK 로드 실패")),
      { once: true },
    );
    document.head.appendChild(script);
  });

  return loadPromise;
}

export interface UsePostcodeReturn {
  /** 팝업을 열고 사용자가 주소를 선택하면 콜백 호출. */
  open: (onComplete: (data: PostcodeResult) => void) => Promise<void>;
  loading: boolean;
}

export function usePostcode(): UsePostcodeReturn {
  const [loading, setLoading] = React.useState(false);

  const open = React.useCallback(
    async (onComplete: (data: PostcodeResult) => void) => {
      setLoading(true);
      try {
        await ensureSdkLoaded();
        const Postcode = window.daum?.Postcode;
        if (!Postcode) throw new Error("우편번호 SDK 가 준비되지 않았습니다.");
        new Postcode({
          oncomplete: (data) => {
            const addressType: "R" | "J" =
              data.userSelectedType === "J" || data.addressType === "J"
                ? "J"
                : "R";
            const address =
              addressType === "R"
                ? (data.roadAddress ?? data.address ?? "")
                : (data.jibunAddress ?? data.address ?? "");
            onComplete({
              zonecode: data.zonecode ?? "",
              address,
              addressType,
            });
          },
        }).open();
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { open, loading };
}
