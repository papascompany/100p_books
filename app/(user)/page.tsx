import { ArrowRight, BookOpen, CheckCircle2, Package, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";

import BookSizeCards from "@/components/home/BookSizeCards";
import FeatureCards from "@/components/home/FeatureCards";
import { Button } from "@/components/ui/button";
import { getSiteContentMany } from "@/lib/content/get";

// StepsSection 만 ssr:false 유지 — 기존 동작 호환을 위해.
const StepsSection = dynamic(() => import("@/components/home/StepsSection"), {
  ssr: false,
  loading: () => (
    <section className="py-12 md:py-20 bg-night">
      <div className="container">
        <div className="mx-auto max-w-xl text-center mb-12 space-y-3">
          <div className="h-4 w-24 bg-white/10 mx-auto rounded" />
          <div className="h-8 w-64 bg-white/10 mx-auto rounded" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border border-white/10 bg-white/5 p-5 space-y-3">
              <div className="size-20 rounded-full bg-white/10 mx-auto md:mx-0" />
              <div className="h-5 w-32 bg-white/10 rounded" />
              <div className="h-4 w-full bg-white/10 rounded" />
            </div>
          ))}
        </div>
      </div>
    </section>
  ),
});

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────

export default async function LandingPage() {
  const content = await getSiteContentMany([
    "home.hero",
    "home.stats",
    "home.features",
    "home.sizes",
    "home.gallery",
    "home.reviews",
    "home.cta",
  ]);
  const { hero, stats, features, sizes, gallery, reviews, cta } = {
    hero: content["home.hero"],
    stats: content["home.stats"],
    features: content["home.features"],
    sizes: content["home.sizes"],
    gallery: content["home.gallery"],
    reviews: content["home.reviews"],
    cta: content["home.cta"],
  };

  return (
    <div className="overflow-x-hidden">

      {/* ══ 1. 캠페인 히어로 ════════════════════════════════════════════════ */}
      <section className="relative min-h-[75vh] flex items-center overflow-hidden">
        <Image
          src={hero.bgImage}
          alt="펼쳐진 감성 사진 앨범"
          fill
          className="object-cover object-center"
          priority
          sizes="100vw"
        />
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(105deg, rgba(20,20,20,0.88) 0%, rgba(20,20,20,0.68) 45%, rgba(20,20,20,0.18) 100%)",
          }}
        />

        <div className="container relative z-10 py-12 md:py-20">
          <div className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-white/50 mb-3">
              {hero.kicker}
            </p>
            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl md:text-6xl text-shadow-lg">
              {hero.titleLine1}
              <br />
              <span className="text-gradient-coral">{hero.titleAccent}</span>
              <br />
              <span className="text-white">{hero.titleLine2}</span>
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-white/70 max-w-[38ch] sm:text-base">
              {hero.sub}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-white/55">
              {hero.badges.map((badge) => (
                <span key={badge} className="flex items-center gap-1">
                  <CheckCircle2 className="size-3.5 text-coral-300" />
                  {badge}
                </span>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="coral" size="lg">
                <Link href={hero.ctaPrimaryHref}>
                  {hero.ctaPrimaryLabel}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                className="bg-transparent text-white border border-white/35 hover:bg-white/10 hover:border-white/55"
              >
                <Link href={hero.ctaSecondaryHref}>{hero.ctaSecondaryLabel}</Link>
              </Button>
            </div>
          </div>
        </div>

        {/* 우측 플로팅 폴라로이드 카드 */}
        <div
          aria-hidden
          className="absolute right-10 top-1/2 -translate-y-1/2 hidden lg:flex flex-col gap-3 z-10"
        >
          {hero.floating.map((card, i) => (
            <div
              key={i}
              className="w-36 bg-white p-2.5 pb-7 rounded-2xl shadow-soft-xl"
              style={{ transform: i === 0 ? "rotate(-4deg)" : "rotate(3deg) translateX(10px)" }}
            >
              <div className="relative h-28 w-full overflow-hidden rounded-xl bg-soft-cloud">
                <Image
                  src={card.image}
                  alt={`포토북 예시 — ${card.caption}`}
                  fill
                  className="object-cover"
                  sizes="144px"
                />
              </div>
              <p className="mt-1.5 text-center text-[10px] font-medium text-mute">{card.caption}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ══ 2. 신뢰 수치 바 ════════════════════════════════════════════════ */}
      <section className="border-y border-hairline bg-card">
        <div className="container">
          <div className="grid grid-cols-2 divide-x divide-hairline md:grid-cols-4">
            {stats.map(({ num, label }) => (
              <div key={label} className="py-4 px-4 text-center md:py-5">
                <p className="font-display-num text-2xl font-bold text-ink md:text-3xl">
                  {num}
                </p>
                <p className="mt-0.5 text-xs text-mute">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 3. 특징 3-컬럼 (사진 배경 + framer-motion) ═════════════════════ */}
      <FeatureCards items={features} />

      {/* ══ 4. 북 사이즈 쇼케이스 (사진 배경 + framer-motion) ══════════════ */}
      <BookSizeCards items={sizes} />

      {/* ══ 5. 사용 방법 3스텝 ══════════════════════════════════════════════ */}
      <StepsSection />

      {/* ══ 6. 갤러리 미리보기 ══════════════════════════════════════════════ */}
      <section className="py-10 md:py-14 bg-soft-cloud">
        <div className="container">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl text-ink">{gallery.heading}</h2>
              <p className="mt-1 text-sm text-mute">{gallery.sub}</p>
            </div>
            <Button asChild variant="coral-outline" size="sm">
              <Link href="/gallery">전체 보기</Link>
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {gallery.images.map(({ src, rowSpan }, i) => (
              <div
                key={i}
                className={`relative overflow-hidden rounded-2xl bg-hairline card-lift${rowSpan ? " row-span-2" : ""}`}
                style={{ aspectRatio: rowSpan ? "3/4" : "1/1" }}
              >
                <Image
                  src={src}
                  alt={`고객 포토북 ${i + 1}`}
                  fill
                  className="object-cover hover:scale-105 transition-transform duration-500"
                  sizes="(max-width: 640px) 50vw, 25vw"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 7. 고객 리뷰 ════════════════════════════════════════════════════ */}
      <section className="py-10 md:py-14 bg-card">
        <div className="container">
          <div className="mx-auto max-w-xl text-center mb-8">
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl text-ink">고객들의 생생한 후기</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {reviews.map(({ name, rating, text }) => (
              <div key={name} className="rounded-2xl border border-hairline bg-card p-5 shadow-soft card-lift">
                <div className="flex gap-0.5 mb-3">
                  {Array.from({ length: rating }).map((_, i) => (
                    <Star key={i} className="size-3.5 fill-star-amber text-star-amber" />
                  ))}
                </div>
                <p className="text-sm leading-relaxed text-foreground mb-4">
                  &ldquo;{text}&rdquo;
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-full bg-coral-50 text-xs font-bold text-coral-700">
                    {name[0]}
                  </div>
                  <span className="text-sm font-medium text-ink">{name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 8. 최종 CTA ═════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-night py-12 md:py-16">
        <Image
          src={cta.image}
          alt="CTA 배경 — 사진집"
          fill
          className="object-cover opacity-20"
          sizes="100vw"
        />
        <div className="container relative z-10 text-center">
          <h2 className="text-3xl font-bold text-white md:text-4xl lg:text-5xl leading-tight">
            {cta.title}{" "}
            <span className="text-coral-300">{cta.accent}</span>
          </h2>
          <p className="mt-3 text-sm text-white/55 max-w-[34ch] mx-auto">
            {cta.sub}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild variant="coral" size="lg">
              <Link href={cta.primaryHref}>
                {cta.primaryLabel} <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              className="bg-transparent text-white border border-white/25 hover:bg-white/10 hover:border-white/45"
            >
              <Link href="/gallery">후기 갤러리 →</Link>
            </Button>
          </div>

          <div className="mt-10 flex justify-center gap-10">
            {[
              { icon: BookOpen, label: "무료 시작" },
              { icon: Package, label: "빠른 배송" },
              { icon: Star, label: "5점 만점" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-1.5">
                <div className="flex size-10 items-center justify-center rounded-full bg-white/10">
                  <Icon className="size-4 text-white/60" />
                </div>
                <span className="text-xs text-white/45">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
