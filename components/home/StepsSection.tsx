import { ArrowRight, Upload, Wand2, ShoppingBag } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * 홈 페이지 — "3분 만에 완성되는 포토북" 3단계 섹션.
 *
 *   - 진입: CSS @keyframes fade-up + animationDelay stagger.
 *     framer-motion(motion/useInView) 의존을 제거해 **RSC 서버 컴포넌트**로 SSR 된다
 *     (FeatureCards / BookSizeCards 와 동일한 패턴).
 *     framer-motion 은 레포에서 이 컴포넌트가 유일한 사용처였으므로 번들에서 완전히 빠진다.
 *   - 호버: motion-safe 조건부 translate + CSS transition (기존 whileHover y:-8 대체).
 *   - 연결선: animate-line-grow-x / -y (기존 scaleX/scaleY variants 대체).
 *
 * 주의: 이 컴포넌트를 다시 클라이언트化 하면 홈 First Load JS 가 크게 늘고
 * (ssr:false 였던 시절 SI/TTI 악화 원인) 섹션이 JS 로드 후에야 보이게 된다.
 */

const STEPS = [
  {
    num: "01",
    icon: Upload,
    title: "사진 업로드",
    desc: "최대 100장. HEIC, JPG, PNG 모두 올릴 수 있고 찍은 순서대로 자동 정렬돼요.",
    accent: "#FF6B5E",
    glow: "rgba(255,107,94,0.35)",
    border: "rgba(255,107,94,0.4)",
  },
  {
    num: "02",
    icon: Wand2,
    title: "자동 배치 & 편집",
    desc: "페이지가 자동으로 채워지고, 원하는 레이아웃으로 자유롭게 바꿀 수 있어요.",
    accent: "#FFD9D2",
    glow: "rgba(255,217,210,0.35)",
    border: "rgba(255,217,210,0.4)",
  },
  {
    num: "03",
    icon: ShoppingBag,
    title: "인쇄 주문",
    desc: "결제 후 3~5일 안에 고품질 포토북이 집 앞에 도착해요.",
    accent: "#FFB23E",
    glow: "rgba(255,178,62,0.35)",
    border: "rgba(255,178,62,0.4)",
  },
] as const;

export default function StepsSection() {
  return (
    <section className="relative py-12 md:py-20 bg-night overflow-hidden">
      {/* 배경 텍스처 그라디언트 */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,107,94,0.05) 0%, transparent 70%)",
        }}
      />

      <div className="container relative z-10">
        {/* 헤더 */}
        <div className="mx-auto max-w-xl text-center mb-12">
          <p
            className="text-xs font-semibold uppercase tracking-[0.25em] text-white/30 mb-3 animate-fade-up"
            style={{ animationDelay: "100ms" }}
          >
            How it works
          </p>
          <h2
            className="text-2xl font-bold tracking-tight text-white md:text-3xl animate-fade-up"
            style={{ animationDelay: "180ms" }}
          >
            3분 만에 완성되는 포토북
          </h2>
          <p
            className="mt-2 text-sm text-white/60 animate-fade-up"
            style={{ animationDelay: "260ms" }}
          >
            세 단계만 거치면 나만의 감성 포토북이 완성돼요.
          </p>
        </div>

        {/* Steps Grid */}
        <div className="relative">
          {/* 데스크탑 연결선 */}
          <div
            aria-hidden
            className="hidden md:block absolute top-[52px] left-[calc(16.66%+40px)] right-[calc(16.66%+40px)] h-px bg-white/8 overflow-hidden"
          >
            <div
              className="h-full origin-left animate-line-grow-x"
              style={{
                background:
                  "linear-gradient(90deg, #FF6B5E 0%, #FFD9D2 50%, #FFB23E 100%)",
                animationDelay: "350ms",
              }}
            />
          </div>

          {/* 모바일 수직 연결선 */}
          <div
            aria-hidden
            className="md:hidden absolute left-6 top-[52px] bottom-[52px] w-px bg-white/8 overflow-hidden"
          >
            <div
              className="w-full origin-top animate-line-grow-y"
              style={{
                background:
                  "linear-gradient(180deg, #FF6B5E 0%, #FFD9D2 50%, #FFB23E 100%)",
                animationDelay: "400ms",
              }}
            />
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {STEPS.map(({ num, icon: Icon, title, desc, accent, glow, border }, i) => (
              <div
                key={num}
                className="relative pl-16 md:pl-0 md:flex md:flex-col md:items-center md:text-center group cursor-default animate-fade-up motion-safe:hover:-translate-y-2 transition-transform duration-300 ease-out"
                style={{ animationDelay: `${300 + i * 200}ms` }}
              >
                {/* 번호 배지 */}
                <div
                  className="relative mb-5 flex-shrink-0 self-start animate-badge-pop"
                  style={{ animationDelay: `${400 + i * 200}ms` }}
                >
                  {/* Outer glow ring — 호버 시 */}
                  <div
                    aria-hidden
                    className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{
                      background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`,
                      transform: "scale(2.2)",
                    }}
                  />
                  {/* Border ring — 호버 시 */}
                  <div
                    aria-hidden
                    className="absolute -inset-2 scale-[0.85] rounded-full border opacity-0 transition-all duration-500 group-hover:scale-110 group-hover:opacity-100"
                    style={{ borderColor: border }}
                  />
                  {/* Badge body */}
                  <div
                    className="relative z-10 flex size-[80px] items-center justify-center rounded-full border"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)",
                      borderColor: "rgba(255,255,255,0.1)",
                    }}
                  >
                    {/* 장식용 대형 숫자 */}
                    <span
                      aria-hidden
                      className="font-display-num absolute text-[72px] font-bold select-none"
                      style={{
                        color: accent,
                        opacity: 0.12,
                        lineHeight: 1,
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      {num}
                    </span>
                    <Icon
                      aria-hidden
                      className="relative z-10 size-7 transition-transform duration-300 group-hover:scale-110"
                      style={{ color: accent }}
                    />
                  </div>

                  {/* Step number label */}
                  <div
                    aria-hidden
                    className="absolute -top-1 -right-1 z-20 flex size-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: accent }}
                  >
                    {parseInt(num, 10)}
                  </div>
                </div>

                {/* 카드 본문 */}
                <div
                  className="relative rounded-none border p-5 transition-all duration-500 group-hover:border-opacity-60"
                  style={{
                    borderColor: "rgba(255,255,255,0.07)",
                    background:
                      "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
                  }}
                >
                  {/* 호버 시 상단 accent 라인 */}
                  <div
                    aria-hidden
                    className="absolute inset-x-0 top-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{
                      background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
                    }}
                  />

                  {/* 배경 대형 숫자 (장식) */}
                  <span
                    aria-hidden
                    className="font-display-num absolute bottom-2 right-3 text-[64px] font-bold leading-none select-none pointer-events-none transition-opacity duration-300 group-hover:opacity-[0.08]"
                    style={{ color: accent, opacity: 0.04 }}
                  >
                    {num}
                  </span>

                  <h3 className="relative text-base font-bold text-white mb-2">
                    {title}
                  </h3>
                  <p className="relative text-sm text-white/60 leading-relaxed">
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div
          className="mt-10 text-center animate-fade-up"
          style={{ animationDelay: "800ms" }}
        >
          {/* variant="coral" 은 bg-coral + text-night (AA 확보) — 예전의 인라인
              `bg-coral text-white` 는 대비 2.79:1 로 미달이었고, ssr:false 라
              접근성 감사에서 검출조차 되지 않았다. */}
          <Button asChild size="lg" variant="coral" className="font-semibold">
            <Link href="/upload">
              지금 시작하기
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
