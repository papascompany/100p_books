import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * 홈 페이지 §4 — "나에게 딱 맞는 사이즈" 사진 배경 카드.
 *
 *   - 카드 = 풀블리드 Unsplash 사진 + 다크 그라디언트 + 흰 텍스트.
 *   - 사이즈별 비율(aspect) 다르게 — 미니/A5 는 세로 길게, 스퀘어는 정사각.
 *   - 진입: CSS @keyframes fadeUp + stagger.
 *   - 호버: 사진 1.07x + 카드 살짝 들림 + coral 라인 + 화살표 →→.
 *   - prefers-reduced-motion: globals.css 가 모든 motion 단축.
 */

interface BookSizeItem {
  name: string;
  size: string;
  desc: string;
  ratio: string;
  imageSrc: string;
  alt: string;
}

const BOOK_SIZES: readonly BookSizeItem[] = [
  {
    name: "미니",
    size: "96×128mm",
    desc: "손에 쏙 들어오는 작은 책",
    ratio: "3/5",
    imageSrc:
      "https://images.unsplash.com/photo-1495640388908-05fa85288e61?w=900&q=80",
    alt: "손에 쏙 들어오는 작은 사진집",
  },
  {
    name: "스퀘어",
    size: "148×148mm",
    desc: "SNS 감성 정사각형 포맷",
    ratio: "1/1",
    imageSrc:
      "https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=900&q=80",
    alt: "정사각형 포맷의 감성 사진집",
  },
  {
    name: "A5",
    size: "148×210mm",
    desc: "일반 노트 사이즈, 넉넉한 여백",
    ratio: "3/5",
    imageSrc:
      "https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=900&q=80",
    alt: "A5 사이즈의 펼쳐진 화보집",
  },
];

export default function BookSizeCards() {
  return (
    <section className="bg-soft-cloud py-12 md:py-16">
      <div className="container">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-8 animate-fade-up">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-mute mb-2">
              Pick Your Size
            </p>
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
              나에게 딱 맞는 사이즈
            </h2>
            <p className="mt-2 text-sm text-mute">
              세 가지 판형 중 원하는 스타일을 선택하세요.
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/upload">
              선택하러 가기 <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>

        <div className="grid gap-3 sm:gap-4 sm:grid-cols-3">
          {BOOK_SIZES.map((b, i) => (
            <Link
              key={b.name}
              href="/upload"
              className="group relative block isolate overflow-hidden rounded-2xl animate-fade-up motion-safe:hover:-translate-y-1.5 transition-transform duration-500 ease-out"
              style={{ aspectRatio: b.ratio, animationDelay: `${120 + i * 120}ms` }}
              aria-label={`${b.name} (${b.size}) 선택하기`}
            >
              <Image
                src={b.imageSrc}
                alt={b.alt}
                fill
                sizes="(max-width: 640px) 100vw, 33vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.07]"
              />

              {/* 다크 그라디언트 */}
              <div
                aria-hidden
                className="absolute inset-0 transition-opacity duration-500"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.30) 45%, rgba(0,0,0,0.85) 100%)",
                }}
              />

              {/* coral wash 호버 */}
              <div
                aria-hidden
                className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(255,107,94,0.06) 0%, transparent 60%)",
                }}
              />

              {/* 사이즈 뱃지 */}
              <div className="absolute left-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur-md ring-1 ring-white/20">
                {b.size}
              </div>

              {/* 본문 */}
              <div className="absolute inset-x-0 bottom-0 z-10 p-5 text-white">
                <h3 className="font-display text-2xl font-bold leading-none md:text-3xl">
                  {b.name}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-white/75">
                  {b.desc}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-coral-300 transition-all duration-300 group-hover:gap-2">
                  선택하기 <ArrowRight className="size-3.5" />
                </span>
              </div>

              {/* coral 하단 라인 */}
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 z-10 h-0.5 origin-left scale-x-0 bg-coral transition-transform duration-500 group-hover:scale-x-100"
              />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
