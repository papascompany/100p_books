import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = {
  title: "오프라인",
  description: "인터넷 연결이 필요합니다.",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
        <WifiOff
          size={36}
          className="text-neutral-400 dark:text-neutral-500"
          aria-hidden
        />
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          인터넷 연결이 없어요
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs mx-auto">
          네트워크 연결을 확인한 뒤 다시 시도해 주세요.
          <br />
          연결이 복구되면 이전 페이지로 돌아갈 수 있어요.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        {/* 브라우저 자체 새로고침 — JavaScript 없이도 동작 */}
        <a
          href="/"
          className="flex items-center justify-center h-11 w-full rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors"
        >
          다시 연결하기
        </a>
        <Link
          href="/"
          className="flex items-center justify-center h-11 w-full rounded-xl border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
        >
          홈으로 이동
        </Link>
      </div>
    </main>
  );
}
