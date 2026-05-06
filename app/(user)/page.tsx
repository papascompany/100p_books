import { ArrowRight, BookOpen, Camera, CheckCircle2, Images, Package, Sparkles, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";

// ─── 데이터 ────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Sparkles,
    title: "자동 레이아웃",
    desc: "사진을 올리면 AI가 EXIF 촬영 시각 기준으로 정렬하고 폴라로이드 페이지를 자동 완성합니다.",
  },
  {
    icon: Camera,
    title: "감성 편집 에디터",
    desc: "2·3·4·6 분할 콜라주, 여백·글씨·스티커까지. 모바일에서도 빠르게 나만의 감성을 담으세요.",
  },
  {
    icon: Images,
    title: "300dpi 인쇄 품질",
    desc: "재단선 포함 인쇄용 PDF를 자동 생성. 전문 인쇄소에서 제작해 집 앞까지 배송합니다.",
  },
] as const;

const STEPS = [
  {
    num: "01",
    title: "사진 업로드",
    desc: "최대 100장. HEIC, JPG, PNG 모두 지원하며 EXIF 기준으로 자동 정렬됩니다.",
    color: "bg-amber-50",
  },
  {
    num: "02",
    title: "자동 배치 & 편집",
    desc: "AI가 페이지를 채우고, 원하는 레이아웃으로 자유롭게 수정하세요.",
    color: "bg-sky-50",
  },
  {
    num: "03",
    title: "인쇄 주문",
    desc: "결제 후 3~5일 안에 고품질 포토북이 도착합니다.",
    color: "bg-rose-50",
  },
] as const;

const BOOK_SIZES = [
  { name: "미니", size: "96×128mm", desc: "손에 쏙 들어오는 작은 책", icon: "📖" },
  { name: "스퀘어", size: "148×148mm", desc: "SNS 감성 정사각형 포맷", icon: "📚" },
  { name: "A5", size: "148×210mm", desc: "일반 노트 사이즈, 넉넉한 여백", icon: "📕" },
] as const;

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
      <section className="relative min-h-[90vh] flex items-center overflow-hidden">
        {/* 배경 사진 */}
        <Image
          src="https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=1920&q=80"
          alt="포토북 배경"
          fill
          className="object-cover object-center"
          priority
          sizes="100vw"
        />
        {/* 다크 오버레이 — 왼쪽 진하게, 오른쪽 투명 */}
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(105deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0.2) 100%)",
          }}
        />

        {/* 콘텐츠 */}
        <div className="container relative z-10 py-20 md:py-32">
          <div className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-white/60 mb-5">
              100 Photos · 1 Book
            </p>

            {/* 메인 헤드라인 — Pretendard 볼드 */}
            <h1 className="text-5xl font-bold leading-[1.1] tracking-tight text-white sm:text-6xl md:text-7xl text-shadow-lg">
              소중한 순간을
              <br />
              <span className="text-amber-300">책으로 만드세요</span>
            </h1>

            <p className="mt-6 text-base leading-relaxed text-white/75 max-w-[38ch] sm:text-lg">
              사진 100장을 업로드하면 AI가 자동으로 폴라로이드 감성
              포토북을 완성합니다. 편집부터 인쇄 주문까지 모두 모바일에서.
            </p>

            {/* 신뢰 지표 */}
            <div className="mt-5 flex items-center gap-4 text-sm text-white/60">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-amber-300" />
                무료 시작
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-amber-300" />
                300dpi 인쇄
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-amber-300" />
                3~5일 배송
              </span>
            </div>

            {/* CTA 버튼 */}
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="bg-white text-[#111111] hover:bg-[#f5f5f5] border-0 font-semibold"
              >
                <Link href="/upload">
                  지금 만들기
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                className="bg-transparent text-white border border-white/40 hover:bg-white/10 hover:border-white/60"
              >
                <Link href="/gallery">후기 갤러리</Link>
              </Button>
            </div>
          </div>
        </div>

        {/* 우측 플로팅 "폴라로이드 미리보기" 카드들 */}
        <div
          aria-hidden
          className="absolute right-8 top-1/2 -translate-y-1/2 hidden lg:flex flex-col gap-4 z-10"
        >
          {/* 폴라로이드 카드 1 */}
          <div
            className="w-44 bg-white p-3 pb-8 shadow-2xl"
            style={{ transform: "rotate(-4deg)" }}
          >
            <div className="relative h-36 w-full overflow-hidden bg-[#f5f5f5]">
              <Image
                src="https://images.unsplash.com/photo-1512438248247-f0f2a5a8b7f0?w=400&q=75"
                alt="포토북 예시"
                fill
                className="object-cover"
                sizes="176px"
              />
            </div>
            <p className="mt-2 text-center text-[11px] font-medium text-[#707072]">우리의 여행 ✈️</p>
          </div>
          {/* 폴라로이드 카드 2 */}
          <div
            className="w-44 bg-white p-3 pb-8 shadow-2xl"
            style={{ transform: "rotate(3deg) translateX(12px)" }}
          >
            <div className="relative h-36 w-full overflow-hidden bg-[#f5f5f5]">
              <Image
                src="https://images.unsplash.com/photo-1511895426328-dc8714191011?w=400&q=75"
                alt="포토북 예시 2"
                fill
                className="object-cover"
                sizes="176px"
              />
            </div>
            <p className="mt-2 text-center text-[11px] font-medium text-[#707072]">가족의 순간 💕</p>
          </div>
        </div>

        {/* 하단 스크롤 힌트 */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2">
          <span className="text-xs text-white/40 tracking-widest uppercase">Scroll</span>
          <div className="w-px h-8 bg-gradient-to-b from-white/40 to-transparent" />
        </div>
      </section>

      {/* ══ 2. 신뢰 수치 바 ════════════════════════════════════════════════ */}
      <section className="border-y border-[#dedede] bg-white">
        <div className="container">
          <div className="grid grid-cols-2 divide-x divide-[#dedede] md:grid-cols-4">
            {[
              { num: "5,000+", label: "제작된 포토북" },
              { num: "4.9", label: "평균 별점", suffix: "★" },
              { num: "300dpi", label: "인쇄 해상도" },
              { num: "3~5일", label: "평균 배송일" },
            ].map(({ num, label, suffix }) => (
              <div key={label} className="py-6 px-4 text-center md:py-8">
                <p className="font-display-num text-3xl font-bold text-[#111111] md:text-4xl">
                  {num}
                  {suffix && <span className="text-amber-400 ml-1">{suffix}</span>}
                </p>
                <p className="mt-1 text-sm text-[#707072]">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 3. 특징 3-컬럼 ══════════════════════════════════════════════════ */}
      <section className="py-20 md:py-28 bg-white">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center mb-14">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              완벽한 포토북을 위한
              <br />
              <span className="text-[#111111]">세 가지 핵심</span>
            </h2>
            <p className="mt-4 text-base text-[#707072]">
              복잡한 디자인 작업 없이도 전문가 수준의 포토북을 만들 수 있습니다.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc }, i) => (
              <div key={title} className="group relative">
                {/* 배경 카드 */}
                <div className="border border-[#dedede] bg-white p-8 h-full transition-shadow hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="flex size-12 items-center justify-center rounded-full bg-[#f5f5f5]">
                      <Icon className="size-5 text-[#111111]" />
                    </div>
                    <span className="font-display-num text-4xl text-[#dedede] font-bold">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold mb-2">{title}</h3>
                  <p className="text-sm text-[#707072] leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 4. 북 사이즈 쇼케이스 ══════════════════════════════════════════ */}
      <section className="py-20 md:py-28 bg-[#f5f5f5]">
        <div className="container">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
            <div>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                나에게 딱 맞는 사이즈
              </h2>
              <p className="mt-3 text-base text-[#707072]">
                세 가지 판형 중 원하는 스타일을 선택하세요.
              </p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/upload">사이즈 선택하러 가기</Link>
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {BOOK_SIZES.map(({ name, size, desc, icon }) => (
              <div
                key={name}
                className="bg-white border border-[#dedede] p-8 flex flex-col gap-4 group hover:border-[#111111] transition-colors cursor-pointer"
              >
                <span className="text-5xl">{icon}</span>
                <div>
                  <p className="text-xl font-bold">{name}</p>
                  <p className="text-sm font-medium text-[#707072] mt-0.5">{size}</p>
                </div>
                <p className="text-sm text-[#707072] leading-relaxed">{desc}</p>
                <div className="mt-auto pt-2">
                  <span className="inline-flex items-center text-sm font-medium text-[#111111] gap-1 group-hover:gap-2 transition-all">
                    선택하기 <ArrowRight className="size-4" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 5. 사용 방법 3스텝 ══════════════════════════════════════════════ */}
      <section className="py-20 md:py-28 bg-white">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center mb-14">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              3분 만에 완성되는 포토북
            </h2>
            <p className="mt-4 text-base text-[#707072]">
              복잡한 과정 없이 세 단계만 거치면 됩니다.
            </p>
          </div>

          <div className="relative">
            {/* 연결선 (데스크탑) */}
            <div className="hidden md:block absolute top-14 left-[16.67%] right-[16.67%] h-px bg-[#dedede]" />

            <div className="grid gap-8 md:grid-cols-3">
              {STEPS.map(({ num, title, desc, color }) => (
                <div key={num} className="relative flex flex-col items-center text-center gap-4">
                  {/* 스텝 번호 원 */}
                  <div className={`relative z-10 flex size-28 items-center justify-center ${color} border border-[#dedede]`}>
                    <span className="font-display-num text-5xl font-bold text-[#111111]">{num}</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold mb-2">{title}</h3>
                    <p className="text-sm text-[#707072] leading-relaxed max-w-[26ch] mx-auto">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-14 text-center">
            <Button asChild size="lg" className="font-semibold">
              <Link href="/upload">
                지금 시작하기
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ══ 6. 갤러리 미리보기 ══════════════════════════════════════════════ */}
      <section className="py-20 md:py-28 bg-[#f5f5f5]">
        <div className="container">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
            <div>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                실제 포토북 후기
              </h2>
              <p className="mt-3 text-base text-[#707072]">
                100p Books로 만든 실제 고객들의 포토북입니다.
              </p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/gallery">전체 후기 보기</Link>
            </Button>
          </div>

          {/* 사진 그리드 — 4컬럼 마소나리 느낌 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { src: "https://images.unsplash.com/photo-1523438885200-e635ba2c371e?w=600&q=75", span: "row-span-2" },
              { src: "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=600&q=75" },
              { src: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=600&q=75" },
              { src: "https://images.unsplash.com/photo-1542038784456-1ea8e935640e?w=600&q=75", span: "row-span-2" },
              { src: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&q=75" },
              { src: "https://images.unsplash.com/photo-1504208434309-cb69f4fe52b0?w=600&q=75" },
            ].map(({ src, span = "" }, i) => (
              <div
                key={i}
                className={`relative overflow-hidden bg-[#dedede] ${span}`}
                style={{ aspectRatio: span ? "3/4" : "1/1" }}
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
      <section className="py-20 md:py-28 bg-white">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              고객들의 생생한 후기
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {REVIEWS.map(({ name, rating, text }) => (
              <div key={name} className="border border-[#dedede] bg-white p-6">
                {/* 별점 */}
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: rating }).map((_, i) => (
                    <Star key={i} className="size-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm leading-relaxed text-[#39393b] mb-5">
                  &ldquo;{text}&rdquo;
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex size-8 items-center justify-center rounded-full bg-[#f5f5f5] text-xs font-bold text-[#111111]">
                    {name[0]}
                  </div>
                  <span className="text-sm font-medium">{name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 8. 최종 CTA ═════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden bg-[#111111] py-20 md:py-28">
        {/* 배경 사진 반투명 */}
        <Image
          src="https://images.unsplash.com/photo-1512438248247-f0f2a5a8b7f0?w=1200&q=60"
          alt="CTA 배경"
          fill
          className="object-cover opacity-20"
          sizes="100vw"
        />
        <div className="container relative z-10 text-center">
          <h2 className="text-4xl font-bold text-white md:text-5xl lg:text-6xl leading-tight">
            이번 여행,
            <br />
            <span className="text-amber-300">책으로 남겨보세요.</span>
          </h2>
          <p className="mt-5 text-base text-white/60 max-w-[36ch] mx-auto">
            지금 사진을 올리면 3분 안에 첫 페이지가 완성됩니다.
            무료로 시작할 수 있어요.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button
              asChild
              size="lg"
              className="bg-white text-[#111111] hover:bg-[#f5f5f5] border-0 font-semibold"
            >
              <Link href="/upload">
                무료로 만들기
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="bg-white/10 text-white border border-white/20 hover:bg-white/20">
              <Link href="/gallery">후기 갤러리 →</Link>
            </Button>
          </div>

          {/* 하단 아이콘 그리드 */}
          <div className="mt-16 grid grid-cols-3 gap-6 max-w-sm mx-auto">
            {[
              { icon: BookOpen, label: "무료 시작" },
              { icon: Package, label: "빠른 배송" },
              { icon: Star, label: "5점 만점" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-2">
                <div className="flex size-12 items-center justify-center rounded-full bg-white/10">
                  <Icon className="size-5 text-white/70" />
                </div>
                <span className="text-xs text-white/50">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
