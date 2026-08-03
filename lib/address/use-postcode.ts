"use client";

import * as React from "react";

/**
 * 다음(카카오) 우편번호 SDK 통합 훅.
 *
 * - CDN 스크립트를 idempotent 하게 동적 로드 (성공 시 1회, 실패 시 재시도 가능)
 * - 훅 마운트 시 SDK 를 프리로드해 사용자 제스처(탭)와 팝업 호출 사이의
 *   async 갭을 제거 — 제스처와 분리된 window.open 은 팝업 차단에 걸리기 쉽다
 * - 데스크톱: `open()` 팝업 / 모바일·터치 환경: 페이지 내 바텀시트 레이어에
 *   `embed()` (iOS Safari·카카오톡 등 인앱 브라우저의 팝업 차단 대응)
 * - SSR 안전: `typeof window` 가드, 콜백은 클라에서만 동작
 */

const SDK_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

/** 모바일/터치 환경 판정 — 이 경우 팝업 대신 embed 바텀시트를 쓴다. */
const EMBED_MEDIA_QUERY = "(max-width: 767px), (pointer: coarse)";

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

  const p = new Promise<void>((resolve, reject) => {
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

  loadPromise = p;
  // 네트워크 오류 등으로 실패하면 캐시를 비워 다음 호출에서 재시도한다.
  p.catch(() => {
    if (loadPromise === p) loadPromise = null;
  });
  return p;
}

function toPostcodeResult(data: DaumPostcodeRaw): PostcodeResult {
  const addressType: "R" | "J" =
    data.userSelectedType === "J" || data.addressType === "J" ? "J" : "R";
  const address =
    addressType === "R"
      ? (data.roadAddress ?? data.address ?? "")
      : (data.jibunAddress ?? data.address ?? "");
  return {
    zonecode: data.zonecode ?? "",
    address,
    addressType,
  };
}

function shouldUseEmbed(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(EMBED_MEDIA_QUERY).matches;
}

/**
 * 모바일용 embed 바텀시트 — 팝업 차단 환경에서도 항상 열린다.
 *
 * Tailwind 클래스 대신 인라인 스타일을 쓰는 이유: 이 레이어는 React 트리 밖에서
 * 명령형으로 생성되므로 콘텐츠 스캔에 의존하지 않는 스타일이 안전하다.
 * (다음 우편번호 위젯 자체가 라이트 테마라 패널도 라이트 고정.)
 */
function openEmbedLayer(
  PostcodeCtor: DaumGlobal["Postcode"],
  onComplete: (data: PostcodeResult) => void,
): () => void {
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "우편번호 검색");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "60",
    background: "rgba(0, 0, 0, 0.5)",
  });

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    position: "absolute",
    left: "0",
    right: "0",
    bottom: "0",
    background: "#ffffff",
    borderRadius: "16px 16px 0 0",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  });
  panel.style.height = "80vh";
  // dvh 지원 브라우저에서는 주소창 변동을 반영한 높이로 교체 (미지원 시 무시됨)
  panel.style.height = "min(85dvh, 640px)";

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 8px 4px 16px",
    borderBottom: "1px solid #e5e7eb",
    flexShrink: "0",
  });

  const title = document.createElement("span");
  title.textContent = "우편번호 검색";
  Object.assign(title.style, {
    fontSize: "14px",
    fontWeight: "600",
    color: "#111827",
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "닫기";
  closeBtn.setAttribute("aria-label", "우편번호 검색 닫기");
  Object.assign(closeBtn.style, {
    minWidth: "44px",
    minHeight: "44px",
    padding: "0 12px",
    background: "transparent",
    border: "none",
    fontSize: "14px",
    color: "#374151",
    cursor: "pointer",
  });

  const body = document.createElement("div");
  Object.assign(body.style, {
    flex: "1",
    minHeight: "0",
    // iOS 홈 인디케이터와 위젯 마지막 행·페이지네이션 겹침 방지
    paddingBottom: "env(safe-area-inset-bottom)",
  });

  const prevOverflow = document.body.style.overflow;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeyDown);
    document.body.style.overflow = prevOverflow;
    overlay.remove();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") cleanup();
  };

  closeBtn.addEventListener("click", cleanup);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cleanup();
  });
  document.addEventListener("keydown", onKeyDown);
  document.body.style.overflow = "hidden";

  header.append(title, closeBtn);
  panel.append(header, body);
  overlay.append(panel);
  document.body.append(overlay);

  const instance = new PostcodeCtor({
    oncomplete: (data) => {
      cleanup();
      onComplete(toPostcodeResult(data));
    },
    width: "100%",
    height: "100%",
  });
  if (typeof instance.embed === "function") {
    instance.embed(body);
    closeBtn.focus();
  } else {
    // embed 미지원 SDK — 팝업으로 폴백 (사실상 도달하지 않는 방어 경로)
    cleanup();
    instance.open();
  }
  return cleanup;
}

export interface UsePostcodeReturn {
  /**
   * 우편번호 검색 UI 를 열고 사용자가 주소를 선택하면 콜백 호출.
   * 데스크톱은 팝업, 모바일·터치 환경은 페이지 내 embed 바텀시트.
   */
  open: (onComplete: (data: PostcodeResult) => void) => Promise<void>;
  loading: boolean;
}

export function usePostcode(): UsePostcodeReturn {
  const [loading, setLoading] = React.useState(false);
  // 문서 레벨 명령형 레이어라 컴포넌트 언마운트(클라이언트 내비 등) 시
  // 오버레이·body 스크롤 락이 새 페이지에 남지 않도록 정리한다.
  const activeCleanupRef = React.useRef<(() => void) | null>(null);

  // 페이지 진입 시 SDK 프리로드 — 첫 탭에서 제스처와 팝업 호출 사이의
  // 네트워크 대기를 없앤다 (실패는 무시 — open() 에서 재시도).
  React.useEffect(() => {
    ensureSdkLoaded().catch(() => undefined);
    return () => {
      activeCleanupRef.current?.();
      activeCleanupRef.current = null;
    };
  }, []);

  const open = React.useCallback(
    async (onComplete: (data: PostcodeResult) => void) => {
      setLoading(true);
      try {
        await ensureSdkLoaded();
        const Postcode = window.daum?.Postcode;
        if (!Postcode) throw new Error("우편번호 SDK 가 준비되지 않았습니다.");
        if (shouldUseEmbed()) {
          activeCleanupRef.current = openEmbedLayer(Postcode, onComplete);
        } else {
          new Postcode({
            oncomplete: (data) => onComplete(toPostcodeResult(data)),
          }).open();
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { open, loading };
}
