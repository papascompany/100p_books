import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    title: "자동 편집",
    desc: "100장의 사진을 EXIF 촬영시각 기준으로 정렬하고, 한 번의 클릭으로 폴라로이드 페이지를 완성합니다.",
  },
  {
    title: "폴라로이드 감성",
    desc: "기본 템플릿부터 2·3·4·6 분할 콜라주까지. 여백·타이포·그림자가 조화를 이루는 인스타 감성.",
  },
  {
    title: "고해상도 인쇄",
    desc: "300dpi · 2mm 재단선이 적용된 인쇄용 PDF를 자동 생성해 실제 책으로 만들어 배송합니다.",
  },
] as const;

const STEPS = [
  { num: "01", title: "사진 업로드", desc: "최대 100장을 한 번에 올리세요. HEIC, JPG, PNG 모두 지원합니다." },
  { num: "02", title: "자동 배치", desc: "AI가 촬영 시각 순으로 정렬하고 페이지를 자동 구성합니다." },
  { num: "03", title: "편집 & 주문", desc: "원하는 대로 수정하고 바로 인쇄 주문까지 완료하세요." },
] as const;

export default function LandingPage() {
  return (
    <>
      {/* ── 캠페인 히어로 ─────────────────────────────────────────────── */}
      <section className="relative min-h-[72vh] bg-[#111111] flex items-end overflow-hidden">
        {/* 배경 — 추후 실제 사진으로 교체 */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a1a] via-[#111111] to-[#0a0a0a]" aria-hidden />
        {/* 텍스처 패턴 */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="container relative z-10 pb-12 pt-20 md:pb-16 md:pt-32">
          {/* Campaign headline */}
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#9e9ea0] mb-4">
            100 Photos · 1 Book
          </p>
          <h1 className="font-campaign text-[clamp(56px,10vw,96px)] leading-[0.9] text-white max-w-[10ch]">
            100장의 순간
            <br />
            한 권의 책
          </h1>
          <p className="mt-6 max-w-[40ch] text-base text-[#9e9ea0] leading-relaxed">
            업로드 한 번으로 폴라로이드 감성 포토북을 만들고, 집 앞까지 배송받으세요.
          </p>

          {/* CTAs — white pill on dark image */}
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="outline" size="lg" className="bg-white text-[#111111] border-0 hover:bg-[#f5f5f5]">
              <Link href="/upload">
                지금 만들기
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" className="bg-transparent text-white border border-white/30 hover:border-white/60 hover:bg-white/10">
              <Link href="/gallery">갤러리 보기</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── 특징 3-up ─────────────────────────────────────────────────── */}
      <section className="py-section">
        <div className="container">
          <h2 className="text-3xl font-semibold tracking-tight mb-12">
            간결하지만, 디테일까지 완벽하게.
          </h2>
          <div className="grid gap-0 md:grid-cols-3 border-t border-[#cacacb]">
            {FEATURES.map(({ title, desc }) => (
              <div key={title} className="py-8 pr-8 border-b md:border-b-0 md:border-r border-[#cacacb] last:border-r-0">
                <h3 className="text-base font-semibold mb-3">{title}</h3>
                <p className="text-sm text-[#707072] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 이용 방법 ──────────────────────────────────────────────────── */}
      <section className="bg-[#f5f5f5] py-section">
        <div className="container">
          <h2 className="text-3xl font-semibold tracking-tight mb-12">
            3단계로 완성하는 포토북
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map(({ num, title, desc }) => (
              <div key={num} className="flex flex-col gap-4">
                <span className="font-campaign text-[48px] text-[#cacacb] leading-none">{num}</span>
                <div>
                  <h3 className="text-base font-semibold mb-1">{title}</h3>
                  <p className="text-sm text-[#707072] leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA 배너 ───────────────────────────────────────────────────── */}
      <section className="bg-[#111111] py-section">
        <div className="container flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-campaign text-[clamp(32px,5vw,48px)] text-white leading-[0.9]">
              이번 여행,<br />책으로 남겨보세요.
            </h2>
            <p className="mt-3 text-sm text-[#9e9ea0]">
              지금 시작하면 3분 안에 첫 페이지가 완성됩니다.
            </p>
          </div>
          <Button asChild variant="outline" size="lg" className="bg-white text-[#111111] border-0 hover:bg-[#f5f5f5] shrink-0">
            <Link href="/upload">
              사진 업로드하기
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
