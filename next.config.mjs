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

  // Next 16 은 `next build` 에서 ESLint 를 더 이상 실행하지 않으므로
  // 예전의 `eslint.ignoreDuringBuilds` 키가 제거되었다(설정 시 검증 오류).
  // 타입 안전성은 tsc(typecheck), 코드 스타일은 `pnpm lint` / CI 가 맡는다.

  // `next dev` 가 AI 코딩 에이전트를 감지하면 프로젝트 루트에 AGENTS.md·CLAUDE.md 를
  // 자동 생성/수정한다(기본 true). 우리 저장소는 두 파일을 직접 관리하므로 끈다.
  agentRules: false,

  // PDF / sharp / canvas / fontkit 는 native binary 의존 — 서버 번들에서 external 로 둔다.
  // (Next 15 에서 experimental.serverComponentsExternalPackages → 최상위로 승격)
  serverExternalPackages: [
    "sharp",
    "pdf-lib",
    "@pdf-lib/fontkit",
    "@napi-rs/canvas",
  ],

  images: {
    // 모바일 최적화: WebP 자동 변환.
    // image/avif 는 계속 제외한다 (SEC-2 완화). advisory GHSA-2xp9-vwfh-vxw4
    // (https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) 자체는
    // Next 16.3.5 에서 해소됐지만, AVIF 재활성화는 인코딩 비용·품질 회귀를 따로 측정한 뒤
    // 후속 웨이브에서 판단한다. Next 16 기본값도 ["image/webp"] 이므로 현행 유지.
    formats: ["image/webp"],
    // 최적화 결과 캐시 TTL(초). Next 16 기본값이 60 → 14400 으로 바뀌었으므로
    // 기존 체감(서명 URL 회전·콘텐츠 교체 반영 속도)을 유지하려고 60 을 명시한다.
    minimumCacheTTL: 60,
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
  },
};

export default nextConfig;
