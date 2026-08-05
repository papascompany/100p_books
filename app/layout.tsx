import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme/ThemeProvider";
import Toaster from "@/components/ui/toaster";
import RegisterSW from "@/components/pwa/RegisterSW";
import InstallPrompt from "@/components/pwa/InstallPrompt";

import "./globals.css";

/**
 * Pretendard 를 2조각으로 나눠 로드한다 (scripts/build-font-subsets.py 로 생성).
 *
 *   core = 라틴·기호·가나 + KS X 1001 한글 2,350자 (533KB) — 실제 화면의 거의 전부를 덮는다.
 *   ext  = 나머지 완성형 한글 8,822자 (1,317KB) — 희귀 음절이 실제로 등장할 때만 받는다.
 *
 * 통짜 2,009KB 를 preload 하던 시절, 운영 Lighthouse 는 TBT 80ms 로 낮은데도
 * TTI 가 12.4s 였다. 병목은 JS 가 아니라 이 폰트의 네트워크 점유였다.
 *
 * unicode-range 를 직접 쓰지 않고 font-family 폴백 체인(tailwind fontFamily.sans)에
 * core → ext 순으로 나열한다. 브라우저는 core 에 없는 글리프를 만날 때만 ext 를 요청하므로
 * next/font 의 자동 fallback 메트릭(size-adjust, CLS 방지)을 그대로 유지할 수 있다.
 */
const pretendard = localFont({
  src: "../public/fonts/Pretendard-core.woff2",
  variable: "--font-pretendard",
  display: "swap",
  preload: true,
  weight: "45 920",
});

const pretendardExt = localFont({
  src: "../public/fonts/Pretendard-ext.woff2",
  variable: "--font-pretendard-ext",
  display: "swap",
  // 희귀 음절 전용 — critical path 에 두지 않는다.
  preload: false,
  weight: "45 920",
});

const bebasNeue = localFont({
  src: "../public/fonts/BebasNeue-Regular.woff2",
  variable: "--font-bebas-neue",
  display: "swap",
  preload: true,
  weight: "400",
});

const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "100p Books — 나만의 포토북",
    template: "%s · 100p Books",
  },
  description:
    "최대 100장의 사진으로 만드는 폴라로이드 감성 포토북. 업로드부터 인쇄 주문까지 한 번에.",
  applicationName: "100p Books",
  authors: [{ name: "100p Books" }],
  keywords: [
    "포토북",
    "사진책",
    "포토프린트",
    "폴라로이드",
    "100p Books",
    "100p_books",
    "주문 인쇄",
  ],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "100p Books",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/icon-192.png",
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "100p Books",
    title: "100p Books — 나만의 포토북",
    description: "100장의 순간, 한 권의 책.",
    url: APP_URL,
    locale: "ko_KR",
  },
  twitter: {
    card: "summary_large_image",
    title: "100p Books — 나만의 포토북",
    description: "100장의 순간, 한 권의 책.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffaf5" },
    { media: "(prefers-color-scheme: dark)", color: "#17120f" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* hydration 전 즉시 다크클래스 적용 — FOUC 방지 */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        {/*
         * preconnect — TCP + TLS 핸드셰이크를 LCP 이전에 미리 수행.
         *   - Supabase Storage / Auth API: 인증된 모든 페이지가 자주 호출.
         *   - Unsplash CDN: 홈 페이지의 사진 6장 + 히어로/CTA 외부 이미지.
         * crossOrigin="" 은 자격증명 없는 동일출처 핸드셰이크 (이미지/Auth 모두 해당).
         */}
        <link
          rel="preconnect"
          href="https://images.unsplash.com"
          crossOrigin=""
        />
        {process.env.NEXT_PUBLIC_SUPABASE_URL ? (
          <link
            rel="preconnect"
            href={process.env.NEXT_PUBLIC_SUPABASE_URL}
            crossOrigin=""
          />
        ) : null}
      </head>
      <body className={`${pretendard.variable} ${pretendardExt.variable} ${bebasNeue.variable} min-h-screen font-sans antialiased bg-background text-foreground`}>
        <ThemeProvider>
          <div className="flex min-h-screen flex-col">{children}</div>
          <Toaster />
          <InstallPrompt />
        </ThemeProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
