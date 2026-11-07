import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installLeaveGuard, useLeaveGuard } from "./use-leave-guard";

const MESSAGE = "업로드가 진행 중이에요. 이 페이지를 나가면 남은 사진 업로드가 취소돼요.";

/** React 루트 리스너 자리 — 가드가 stopPropagation 하면 여기까지 오지 않는다. */
let container: HTMLDivElement;
let reachedRoot: number;

function onRootClick(e: MouseEvent) {
  reachedRoot++;
  // jsdom 은 실제 이동을 구현하지 않는다 — 경고 로그를 막기 위해 여기서 멈춘다.
  e.preventDefault();
}

function addLink(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  const span = document.createElement("span");
  span.textContent = "link";
  a.appendChild(span);
  container.appendChild(a);
  return a;
}

function click(el: Element, init: MouseEventInit = {}): MouseEvent {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  el.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  window.history.pushState({}, "", "/upload?projectId=p1");
  container = document.createElement("div");
  container.addEventListener("click", onRootClick);
  document.body.appendChild(container);
  reachedRoot = 0;
});

afterEach(() => {
  container.removeEventListener("click", onRootClick);
  container.remove();
  vi.restoreAllMocks();
});

describe("installLeaveGuard", () => {
  it("같은 출처 내부 링크 — 확인을 거부하면 이동을 막고 Link 핸들러까지 전파하지 않는다", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const dispose = installLeaveGuard(MESSAGE);
    const ev = click(addLink("/projects").firstElementChild!);
    dispose();

    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(ev.defaultPrevented).toBe(true);
    expect(reachedRoot).toBe(0);
  });

  it("확인을 승인하면 이동을 그대로 진행한다", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const dispose = installLeaveGuard(MESSAGE);
    click(addLink("/editor/p1"));
    dispose();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(reachedRoot).toBe(1);
  });

  it.each([
    ["수정키(cmd) 클릭", "/projects", {}, { metaKey: true }],
    ["ctrl 클릭", "/projects", {}, { ctrlKey: true }],
    ["shift 클릭", "/projects", {}, { shiftKey: true }],
    ["보조 버튼 클릭", "/projects", {}, { button: 1 }],
    ["target=_blank", "/projects", { target: "_blank" }, {}],
    ["download 링크", "/files/a.pdf", { download: "" }, {}],
    ["다른 출처", "https://example.com/x", {}, {}],
    ["mailto", "mailto:help@example.com", {}, {}],
    ["같은 경로 해시 이동", "/upload?projectId=p1#grid", {}, {}],
    ["같은 경로", "/upload?projectId=p1", {}, {}],
  ] as const)("%s 는 확인하지 않는다", (_name, href, attrs, init) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const dispose = installLeaveGuard(MESSAGE);
    click(addLink(href, attrs), init);
    dispose();

    expect(confirm).not.toHaveBeenCalled();
    expect(reachedRoot).toBe(1);
  });

  it("같은 경로라도 쿼리가 다르면 다른 화면이므로 확인한다", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const dispose = installLeaveGuard(MESSAGE);
    click(addLink("/upload"));
    dispose();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(reachedRoot).toBe(0);
  });

  it("이미 다른 핸들러가 막은 클릭과 링크가 아닌 요소는 무시한다", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const dispose = installLeaveGuard(MESSAGE);
    const button = document.createElement("button");
    container.appendChild(button);
    click(button);
    const prevented = new MouseEvent("click", { bubbles: true, cancelable: true });
    prevented.preventDefault();
    addLink("/projects").dispatchEvent(prevented);
    dispose();

    expect(confirm).not.toHaveBeenCalled();
  });

  it("beforeunload 를 막고, 링크 확인 승인 직후의 beforeunload 는 다시 묻지 않는다", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const dispose = installLeaveGuard(MESSAGE);

    const first = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);

    click(addLink("/projects"));
    const second = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    dispose();
  });

  it("해제하면 더 이상 가로채지 않는다", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    installLeaveGuard(MESSAGE)();
    click(addLink("/projects"));
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);

    expect(confirm).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("useLeaveGuard", () => {
  let root: Root;
  let host: HTMLDivElement;

  function Probe({ active }: { active: boolean }) {
    useLeaveGuard(active, MESSAGE);
    return null;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("active 일 때만 가드가 걸리고, false 가 되거나 언마운트되면 풀린다", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = addLink("/projects");

    act(() => root.render(createElement(Probe, { active: false })));
    click(link);
    expect(confirm).not.toHaveBeenCalled();

    act(() => root.render(createElement(Probe, { active: true })));
    click(link);
    expect(confirm).toHaveBeenCalledTimes(1);

    act(() => root.render(createElement(Probe, { active: false })));
    click(link);
    expect(confirm).toHaveBeenCalledTimes(1);

    act(() => root.render(createElement(Probe, { active: true })));
    act(() => root.unmount());
    root = createRoot(host);
    click(link);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
