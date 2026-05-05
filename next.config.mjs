/** @type {import('next').NextConfig} */
const supabaseHost =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, "") ??
  "XXX.supabase.co";

const nextConfig = {
  reactStrictMode: true,
  images: {
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
