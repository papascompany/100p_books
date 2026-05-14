import Image from "next/image";

/**
 * 홈 페이지 §3 — "완벽한 포토북을 위한 세 가지 핵심" 사진 배경 카드.
 *
 *   - 카드 = 풀블리드 Unsplash 사진 + 다크 그라디언트 + 흰 텍스트.
 *   - 진입: CSS @keyframes fadeUp + stagger (animation-delay 로 카드별 차등).
 *     framer-motion 의 useInView 의존 제거 — RSC server 컴포넌트로 SSR 가능 + 번들 0.
 *   - 호버: 사진 1.06x 확대 + 오버레이 옅어짐 + amber 라인 좌→우 확장.
 *   - prefers-reduced-motion: 전역 CSS 가 모든 animation/transition 을 0.01ms 로 단축.
 */

interface FeatureItem {
  num: string;
  title: string;
  desc: string;
  imageSrc: string;
  alt: string;
}

const FEATURES: readonly FeatureItem[] = [
  {
    num: "01",
    title: "자동 레이아웃",
    desc: "사진을 올리면 AI가 EXIF 촬영 시각 기준으로 정렬하고 폴라로이드 페이지를 자동 완성합니다.",
    imageSrc:
      "https://images.unsplash.com/photo-1606159068539-43f36b99d1b2?w=900&q=80",
    alt: "폴라로이드 사진들이 가지런히 정렬된 모습",
  },
  {
    num: "02",
    title: "감성 편집 에디터",
    desc: "2·3·4·6 분할 콜라주, 여백·글씨·스티커까지. 모바일에서도 빠르게 나만의 감성을 담으세요.",
    imageSrc:
      "https://images.unsplash.com/photo-1530538987395-032d1800fdd4?w=900&q=80",
    alt: "빈티지한 분위기로 펼쳐진 사진 앨범",
  },
  {
    num: "03",
    title: "300dpi 인쇄 품질",
    desc: "재단선 포함 인쇄용 PDF를 자동 생성. 전문 인쇄소에서 제작해 집 앞까지 배송합니다.",
    imageSrc:
      "https://images.unsplash.com/photo-1532012197267-da84d127e765?w=900&q=80",
    alt: "고품질 인쇄로 펼쳐진 사진집의 디테일",
  },
];

export default function FeatureCards() {
  return (
    <section className="bg-white py-12 md:py-16">
      <div className="container">
        <div className="mx-auto max-w-xl text-center mb-10 animate-fade-up">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#707072] mb-2">
            Why 100p Books
          </p>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            완벽한 포토북을 위한{" "}
            <span className="relative inline-block">
              <span className="relative z-10">세 가지 핵심</span>
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-1 z-0 h-2 bg-amber-300/60"
              />
            </span>
          </h2>
          <p className="mt-3 text-sm text-[#707072]">
            복잡한 디자인 작업 없이도 전문가 수준의 포토북을 만들 수 있어요.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3 md:gap-5">
          {FEATURES.map((f, i) => (
            <article
              key={f.num}
              className="group relative isolate overflow-hidden aspect-[4/5] md:aspect-[3/4] cursor-default animate-fade-up motion-safe:hover:-translate-y-1 transition-transform duration-300 ease-out"
              style={{ animationDelay: `${120 + i * 120}ms` }}
            >
              <Image
                src={f.imageSrc}
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

              {/* amber 호버 라인 */}
              <div
                aria-hidden
                className="absolute left-6 right-6 bottom-32 h-px origin-left scale-x-0 bg-amber-300/85 transition-transform duration-500 group-hover:scale-x-100"
              />

              <div className="relative z-10 flex h-full flex-col justify-between p-6 text-white">
                <span className="font-display-num text-xs tracking-[0.3em] text-white/70">
                  {f.num} / 03
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
