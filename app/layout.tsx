import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme/ThemeProvider";
import Toaster from "@/components/ui/toaster";
import RegisterSW from "@/components/pwa/RegisterSW";
import InstallPrompt from "@/components/pwa/InstallPrompt";

import "./globals.css";

const pretendard = localFont({
  src: "../public/fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
  preload: true,
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
      </head>
      <body className={`${pretendard.variable} ${bebasNeue.variable} min-h-screen font-sans antialiased bg-background text-foreground`}>
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
