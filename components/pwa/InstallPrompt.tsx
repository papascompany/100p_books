"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Share } from "lucide-react";

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "none";

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "none";

  const ua = navigator.userAgent;

  // 이미 standalone(설치됨) 모드이면 숨김
  if (window.matchMedia("(display-mode: standalone)").matches) return "none";
  // iOS Safari의 standalone 프로퍼티
  if ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone) return "none";

  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/chrome|crios|fxios/i.test(ua);

  if (isIOS && isSafari) return "ios";

  // Android Chrome / Samsung Browser
  const isAndroidChrome =
    /android/i.test(ua) && (/chrome/i.test(ua) || /samsung/i.test(ua));
  if (isAndroidChrome) return "android";

  return "none";
}

const SESSION_KEY = "pwa-install-dismissed";

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export default function InstallPrompt() {
  const [platform, setPlatform] = useState<Platform>("none");
  const [visible, setVisible] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // 이번 세션에 이미 닫았으면 표시하지 않음
    if (sessionStorage.getItem(SESSION_KEY)) return;

    const detected = detectPlatform();
    if (detected === "none") return;

    if (detected === "android") {
      // beforeinstallprompt 이벤트 대기
      const handler = (e: Event) => {
        e.preventDefault();
        deferredPrompt.current = e as BeforeInstallPromptEvent;
        setPlatform("android");
        setVisible(true);
      };
      window.addEventListener("beforeinstallprompt", handler);
      return () => window.removeEventListener("beforeinstallprompt", handler);
    }

    if (detected === "ios") {
      setPlatform("ios");
      setVisible(true);
    }
  }, []);

  function dismiss() {
    sessionStorage.setItem(SESSION_KEY, "1");
    setVisible(false);
  }

  async function handleInstall() {
    if (!deferredPrompt.current) return;
    await deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    if (outcome === "accepted") {
      deferredPrompt.current = null;
    }
    dismiss();
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="install-prompt"
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="fixed bottom-0 left-0 right-0 z-[200] px-4 pb-safe-bottom"
          role="dialog"
          aria-modal="false"
          aria-label="앱 설치 안내"
        >
          <div className="mb-4 rounded-2xl bg-white dark:bg-neutral-900 shadow-[0_4px_32px_rgba(0,0,0,0.12)] border border-neutral-100 dark:border-neutral-800 p-5">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/icons/icon-192.png"
                  alt="100p Books 아이콘"
                  width={40}
                  height={40}
                  className="rounded-xl"
                />
                <div>
                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    100p Books
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    홈 화면에 추가하기
                  </p>
                </div>
              </div>
              <button
                onClick={dismiss}
                aria-label="닫기"
                className="p-2 -mr-1 rounded-full text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            {/* 플랫폼별 안내 */}
            {platform === "ios" ? (
              <IosGuide onDismiss={dismiss} />
            ) : (
              <AndroidGuide onInstall={handleInstall} onDismiss={dismiss} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── iOS 안내 ──────────────────────────────────────────────────────────────────

function IosGuide({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div>
      <p className="text-sm text-neutral-700 dark:text-neutral-300 mb-3">
        Safari 하단의{" "}
        <span className="inline-flex items-center gap-0.5 align-middle">
          <Share size={14} className="text-blue-500" aria-hidden />
          <span className="font-medium text-blue-500">공유</span>
        </span>{" "}
        버튼을 탭한 뒤{" "}
        <span className="font-medium">&apos;홈 화면에 추가&apos;</span>를 선택하세요.
      </p>
      <button
        onClick={onDismiss}
        className="w-full py-2.5 rounded-xl text-sm font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
      >
        나중에
      </button>
    </div>
  );
}

// ── Android 안내 ─────────────────────────────────────────────────────────────

function AndroidGuide({
  onInstall,
  onDismiss,
}: {
  onInstall: () => Promise<void>;
  onDismiss: () => void;
}) {
  return (
    <div>
      <p className="text-sm text-neutral-700 dark:text-neutral-300 mb-3">
        앱처럼 설치하면 더 빠르게 이용할 수 있어요.
      </p>
      <div className="flex gap-2">
        <button
          onClick={onDismiss}
          className="flex-1 py-2.5 rounded-xl text-sm font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
        >
          나중에
        </button>
        <button
          onClick={onInstall}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 transition-colors flex items-center justify-center gap-1.5"
        >
          <Download size={15} aria-hidden />
          설치하기
        </button>
      </div>
    </div>
  );
}
