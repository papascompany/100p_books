/**
 * 이미지 최적화 허용 원격 원본 (SEC-4).
 *
 * - Supabase: **우리 프로젝트 호스트만** 허용한다. 예전의 `*.supabase.co` 와일드카드는
 *   남의 무료 프로젝트 public 버킷까지 `/_next/image` 로 최적화시켜 줄 수 있었다.
 *   실제 사용처는 storage 의 signed(`/object/sign/…`)·public(`/object/public/site-assets/…`) URL 뿐이다.
 * - NEXT_PUBLIC_SUPABASE_URL 이 없거나 형식이 틀린 빌드(로컬 등)에서는 패턴을 **빼고** 빌드를 계속한다.
 *   예전 fallback 호스트("XXX.supabase.co")를 넣는 대신 — 그 빌드에선 원격 Supabase 이미지가
 *   어차피 존재할 수 없다. CI 는 더미 URL 을 주므로 패턴이 그대로 생긴다.
 * - Unsplash: 홈 기본 콘텐츠(lib/content/defaults.ts)가 쓰는 `/photo-…` 경로만.
 *
 * @returns {import('next/dist/shared/lib/image-config').RemotePattern | null}
 */
function supabaseStoragePattern() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    const { protocol, hostname } = new URL(raw);
    return {
      protocol: protocol === "http:" ? "http" : "https",
      hostname,
      pathname: "/storage/v1/object/**",
    };
  } catch {
    return null;
  }
}

const supabasePattern = supabaseStoragePattern();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // `x-powered-by: Next.js` 응답 헤더 제거 (OPS-12) — 프레임워크 지문 최소화.
  poweredByHeader: false,

  // ESLint 스타일 룰(react/no-unescaped-entities 등)로 production 빌드가
  // 막히지 않게 함 — 타입 안전성은 tsc(typecheck)가 별도 보장하고,
  // 코드 스타일은 `pnpm lint` / CI 에서 점검한다.
  eslint: {
    ignoreDuringBuilds: true,
  },

  images: {
    // 모바일 최적화: WebP 자동 변환.
    // image/avif 는 일시 제외 (SEC-2 완화) — Next.js 14.2.35 는 AVIF 최적화 경로 advisory
    // GHSA-2xp9-vwfh-vxw4 (https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)
    // 의 패치가 없는 지원 종료 버전이다. Next 16 전환 후 advisory 해소를 확인하고 재검토한다.
    formats: ["image/webp"],
    // 디바이스별 최적 크기
    deviceSizes: [375, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 64, 128, 256, 384],
    remotePatterns: [
      ...(supabasePattern ? [supabasePattern] : []),
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/photo-*",
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
