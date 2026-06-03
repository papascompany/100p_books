import Image from "next/image";

import { SITE_CONTENT_DEFAULTS } from "@/lib/content/defaults";
import type { FeatureItem } from "@/lib/content/types";

/**
 * 홈 페이지 §3 — "사진만 올리면 감성 포토북 완성" 사진 배경 카드.
 *
 *   - 카드 = 풀블리드 Unsplash 사진 + 다크 그라디언트 + 흰 텍스트.
 *   - 진입: CSS @keyframes fadeUp + stagger (animation-delay 로 카드별 차등).
 *     framer-motion 의 useInView 의존 제거 — RSC server 컴포넌트로 SSR 가능 + 번들 0.
 *   - 호버: 사진 1.06x 확대 + 오버레이 옅어짐 + coral 라인 좌→우 확장.
 *   - prefers-reduced-motion: 전역 CSS 가 모든 animation/transition 을 0.01ms 로 단축.
 */

export default function FeatureCards({ items }: { items?: FeatureItem[] }) {
  const data = items ?? SITE_CONTENT_DEFAULTS["home.features"];
  return (
    <section className="bg-card py-12 md:py-16">
      <div className="container">
        <div className="mx-auto max-w-xl text-center mb-10 animate-fade-up">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-mute mb-2">
            Why 100p Books
          </p>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            사진만 올리면{" "}
            <span className="relative inline-block">
              <span className="relative z-10">감성 포토북 완성</span>
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-1 z-0 h-2 bg-coral-200/70"
              />
            </span>
          </h2>
          <p className="mt-3 text-sm text-mute">
            복잡한 디자인 없이도 나만의 포토북을 만들 수 있어요.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3 md:gap-5">
          {data.map((f, i) => (
            <article
              key={f.num}
              className="group relative isolate overflow-hidden rounded-2xl aspect-[4/5] md:aspect-[3/4] cursor-default animate-fade-up motion-safe:hover:-translate-y-1 transition-transform duration-300 ease-out"
              style={{ animationDelay: `${120 + i * 120}ms` }}
            >
              <Image
                src={f.image}
                alt={f.alt}
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
              />

              {/* 다크 그라디언트 오버레이 */}
              <div
                aria-hidden
                className="absolute inset-0 transition-opacity duration-500 group-hover:opacity-90"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0.85) 100%)",
                }}
              />

              {/* coral 호버 라인 */}
              <div
                aria-hidden
                className="absolute left-6 right-6 bottom-32 h-px origin-left scale-x-0 bg-coral-300/85 transition-transform duration-500 group-hover:scale-x-100"
              />

              <div className="relative z-10 flex h-full flex-col justify-between p-6 text-white">
                <span className="font-display-num text-xs tracking-[0.3em] text-white/70">
                  {f.num} / {String(data.length).padStart(2, "0")}
                </span>
                <div className="transition-transform duration-500 ease-out group-hover:-translate-y-1">
                  <h3 className="text-xl font-bold leading-tight md:text-2xl">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/75">
                    {f.desc}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
