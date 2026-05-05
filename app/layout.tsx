import type { Metadata, Viewport } from "next";

import { ThemeProvider, THEME_INIT_SCRIPT } from "@/components/theme/ThemeProvider";
import Toaster from "@/components/ui/toaster";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "100p Books — 나만의 포토북",
    template: "%s · 100p Books",
  },
  description:
    "최대 100장의 사진으로 만드는 폴라로이드 감성 포토북. 업로드부터 인쇄 주문까지 한 번에.",
  applicationName: "100p Books",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    type: "website",
    title: "100p Books — 나만의 포토북",
    description: "100장의 순간, 한 권의 책.",
    locale: "ko_KR",
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
      <body className="min-h-screen font-sans antialiased bg-background text-foreground">
        <ThemeProvider>
          <div className="flex min-h-screen flex-col">{children}</div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
