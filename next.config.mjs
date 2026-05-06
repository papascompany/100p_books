/** @type {import('next').NextConfig} */
const supabaseHost =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, "") ??
  "XXX.supabase.co";

const nextConfig = {
  reactStrictMode: true,

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
    ],
  },

  experimental: {
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
