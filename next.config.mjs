/** @type {import('next').NextConfig} */
const supabaseHost =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, "") ??
  "XXX.supabase.co";

const nextConfig = {
  reactStrictMode: true,

  // ESLint 스타일 룰(react/no-unescaped-entities 등)로 production 빌드가
  // 막히지 않게 함 — 타입 안전성은 tsc(typecheck)가 별도 보장하고,
  // 코드 스타일은 `pnpm lint` / CI 에서 점검한다.
  eslint: {
    ignoreDuringBuilds: true,
  },

  images: {
    // 모바일 최적화: WebP/AVIF 자동 변환
    formats: ["image/avif", "image/webp"],
    // 디바이스별 최적 크기
    deviceSizes: [375, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 64, 128, 256, 384],
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHost,
        pathname: "/storage/v1/object/**",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },

  experimental: {
    // App Router 클라이언트 측 Router Cache 의 TTL.
    // 다녀온 페이지를 다시 방문할 때 prefetch 한 RSC payload 를 재사용 → 즉시 표시.
    // dynamic 30s 는 우리 mypage/주문/에디터 진입 동선에서 가장 큰 체감 향상.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    // 클라이언트 번들 최적화: 아이콘/UI 라이브러리 tree-shaking 강제
    // lucide-react 단독으로 ~500KB 절감 가능
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-popover",
      "@radix-ui/react-tooltip",
      "date-fns",
    ],
    serverActions: {
      bodySizeLimit: "4mb",
    },
    // PDF / sharp / canvas / fontkit 는 native binary 의존 — 클라 번들 제외
    serverComponentsExternalPackages: [
      "sharp",
      "pdf-lib",
      "@pdf-lib/fontkit",
      "@napi-rs/canvas",
    ],
  },
};

export default nextConfig;
