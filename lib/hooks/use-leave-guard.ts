"use client";

import { useEffect } from "react";

/**
 * 이탈 경고 — 하드 내비게이션(새로고침·탭 닫기)과 같은 출처 `<a href>` 소프트 내비게이션을 함께 막는다.
 *
 * App Router 의 `<Link>` 이동은 beforeunload 가 발화하지 않아, 진행 중인 작업(업로드·미저장 편집)이
 * 경고 없이 사라진다. document capture 단계에서 링크 클릭을 먼저 받아 `window.confirm` 으로 확인하고,
 * 거부하면 preventDefault + stopPropagation 으로 Next 의 Link 핸들러(React 루트 리스너)까지 막는다.
 *
 * 제외: 수정키·보조 버튼 클릭, target 이 `_self` 가 아닌 링크, download 링크, 다른 출처·비 http 링크,
 * 같은 경로(pathname+search)로의 이동(해시 이동 포함 — 화면이 바뀌지 않는다).
 * `<a>` 가 아닌 버튼의 router.push(에디터의 navigateTo·flushAndNavigate)는 건드리지 않는다.
 */

/** 이 클릭이 확인이 필요한 같은 출처 내부 이동인지 판정한다. 아니면 null, 맞으면 목적지 URL. */
export function guardedNavigationTarget(
  event: MouseEvent,
  current: Location | URL,
): URL | null {
  if (event.defaultPrevented) return null;
  if (event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

  const origin = event.target;
  if (!(origin instanceof Element)) return null;
  const anchor = origin.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;

  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;

  let url: URL;
  try {
    url = new URL(anchor.href, current.href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== current.origin) return null;
  // 같은 경로 — 해시 이동이거나 현재 화면 그대로다(컴포넌트가 유지된다).
  if (url.pathname === current.pathname && url.search === current.search) return null;
  return url;
}

/**
 * 가드를 설치하고 해제 함수를 돌려준다. 훅 바깥(테스트 등)에서도 쓸 수 있도록 분리했다.
 * 확인을 승인한 직후에는 같은 이동이 하드 내비게이션이어도 beforeunload 가 두 번 묻지 않게 잠시 건너뛴다.
 */
export function installLeaveGuard(message: string, win: Window = window): () => void {
  let bypassUntil = 0;

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (Date.now() < bypassUntil) return;
    e.preventDefault();
    // 구형 브라우저 호환 — 실제 문구는 브라우저 기본 문구로 대체된다.
    e.returnValue = message;
  }

  function onClickCapture(e: MouseEvent) {
    if (!guardedNavigationTarget(e, win.location)) return;
    if (win.confirm(message)) {
      bypassUntil = Date.now() + 1_000;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  win.addEventListener("beforeunload", onBeforeUnload);
  win.document.addEventListener("click", onClickCapture, true);
  return () => {
    win.removeEventListener("beforeunload", onBeforeUnload);
    win.document.removeEventListener("click", onClickCapture, true);
  };
}

/** active 인 동안만 이탈 경고를 건다. */
export function useLeaveGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;
    return installLeaveGuard(message);
  }, [active, message]);
}
