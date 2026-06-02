import { ArrowRight, BookOpen, CheckCircle2, Package, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";

import BookSizeCards from "@/components/home/BookSizeCards";
import FeatureCards from "@/components/home/FeatureCards";
import { Button } from "@/components/ui/button";

// StepsSection 만 ssr:false 유지 — 기존 동작 호환을 위해.
const StepsSection = dynamic(() => import("@/components/home/StepsSection"), {
  ssr: false,
  loading: () => (
    <section className="py-12 md:py-20 bg-ink">
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

// ─── 데이터 ────────────────────────────────────────────────────────────────
// FEATURES / BOOK_SIZES 는 각각 FeatureCards / BookSizeCards 컴포넌트로 이전됨.

const REVIEWS = [
  { name: "김지현", rating: 5, text: "결혼기념일 선물로 주문했는데 너무 예쁘게 나왔어요! 남편이 감동받았습니다." },
  { name: "박서준", rating: 5, text: "여행 사진 100장으로 포토북 만들었는데 퀄리티가 정말 좋네요. 다음 여행도 꼭 만들 것 같아요." },
  { name: "이수아", rating: 5, text: "아기 첫돌 기념으로 제작했어요. 인쇄 색감이 선명하고 종이 질도 두껍고 좋아요!" },
] as const;

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="overflow-x-hidden">

      {/* ══ 1. 캠페인 히어로 ════════════════════════════════════════════════ */}
      <section className="relative min-h-[75vh] flex items-center overflow-hidden">
        <Image
          src="https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=1920&q=80"
          alt="포토북 배경"
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
              100 Photos · 1 Book
            </p>
            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl md:text-6xl text-shadow-lg">
              사진만 고르세요,
              <br />
              <span className="text-gradient-coral">포토북은 100p가</span>
              <br />
              <span className="text-white">만들게요.</span>
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-white/70 max-w-[38ch] sm:text-base">
              업로드하면 AI가 자동으로 예쁘게 배치 — 3분이면 끝나요.
              편집부터 인쇄 주문까지 모두 모바일에서.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-white/55">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="size-3.5 text-coral-300" />
                무료 시작
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="size-3.5 text-coral-300" />
                300dpi 인쇄
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="size-3.5 text-coral-300" />
                3~5일 배송
              </span>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="coral" size="lg">
                <Link href="/upload">
                  지금 만들기
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                className="bg-transparent text-white border border-white/35 hover:bg-white/10 hover:border-white/55"
              >
                <Link href="/gallery">후기 갤러리</Link>
              </Button>
            </div>
          </div>
        </div>

        {/* 우측 플로팅 폴라로이드 카드 */}
        <div
          aria-hidden
          className="absolute right-10 top-1/2 -translate-y-1/2 hidden lg:flex flex-col gap-3 z-10"
        >
          <div className="w-36 bg-white p-2.5 pb-7 rounded-2xl shadow-soft-xl" style={{ transform: "rotate(-4deg)" }}>
            <div className="relative h-28 w-full overflow-hidden rounded-xl bg-soft-cloud">
              <Image
                src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=400&q=75"
                alt="포토북 예시"
                fill
                className="object-cover"
                sizes="144px"
              />
            </div>
            <p className="mt-1.5 text-center text-[10px] font-medium text-mute">우리의 여행</p>
          </div>
          <div className="w-36 bg-white p-2.5 pb-7 rounded-2xl shadow-soft-xl" style={{ transform: "rotate(3deg) translateX(10px)" }}>
            <div className="relative h-28 w-full overflow-hidden rounded-xl bg-soft-cloud">
              <Image
                src="https://images.unsplash.com/photo-1523438885200-e635ba2c371e?w=400&q=75"
                alt="포토북 예시 2"
                fill
                className="object-cover"
                sizes="144px"
              />
            </div>
            <p className="mt-1.5 text-center text-[10px] font-medium text-mute">가족의 순간</p>
          </div>
        </div>
      </section>

      {/* ══ 2. 신뢰 수치 바 ════════════════════════════════════════════════ */}
      <section className="border-y border-hairline bg-white">
        <div className="container">
          <div className="grid grid-cols-2 divide-x divide-hairline md:grid-cols-4">
            {[
              { num: "5,000+", label: "제작된 포토북" },
              { num: "4.9★", label: "평균 별점" },
              { num: "300dpi", label: "인쇄 해상도" },
              { num: "3~5일", label: "평균 배송일" },
            ].map(({ num, label }) => (
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
      <FeatureCards />

      {/* ══ 4. 북 사이즈 쇼케이스 (사진 배경 + framer-motion) ══════════════ */}
      <BookSizeCards />

      {/* ══ 5. 사용 방법 3스텝 ══════════════════════════════════════════════ */}
      <StepsSection />

      {/* ══ 6. 갤러리 미리보기 ══════════════════════════════════════════════ */}
      <section className="py-10 md:py-14 bg-soft-cloud">
        <div className="container">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl text-ink">실제 포토북 후기</h2>
              <p className="mt-1 text-sm text-mute">100p Books로 만든 실제 고객들의 포토북입니다.</p>
            </div>
            <Button asChild variant="coral-outline" size="sm">
              <Link href="/gallery">전체 보기</Link>
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { src: "https://images.unsplash.com/photo-1523438885200-e635ba2c371e?w=600&q=75", rowSpan: true },
              { src: "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=600&q=75" },
              { src: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=600&q=75" },
              { src: "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=600&q=75", rowSpan: true },
              { src: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&q=75" },
              { src: "https://images.unsplash.com/photo-1504208434309-cb69f4fe52b0?w=600&q=75" },
            ].map(({ src, rowSpan }, i) => (
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
      <section className="py-10 md:py-14 bg-white">
        <div className="container">
          <div className="mx-auto max-w-xl text-center mb-8">
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl text-ink">고객들의 생생한 후기</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {REVIEWS.map(({ name, rating, text }) => (
              <div key={name} className="rounded-2xl border border-hairline bg-white p-5 shadow-soft card-lift">
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
      <section className="relative overflow-hidden bg-ink py-12 md:py-16">
        <Image
          src="https://images.unsplash.com/photo-1504208434309-cb69f4fe52b0?w=1200&q=60"
          alt="CTA 배경"
          fill
          className="object-cover opacity-20"
          sizes="100vw"
        />
        <div className="container relative z-10 text-center">
          <h2 className="text-3xl font-bold text-white md:text-4xl lg:text-5xl leading-tight">
            100장의 순간을{" "}
            <span className="text-coral-300">한 권의 감성으로.</span>
          </h2>
          <p className="mt-3 text-sm text-white/55 max-w-[34ch] mx-auto">
            지금 사진을 올리면 3분 안에 첫 페이지가 완성됩니다. 무료로 시작할 수 있어요.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild variant="coral" size="lg">
              <Link href="/upload">
                무료로 만들기 <ArrowRight className="size-4" />
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
