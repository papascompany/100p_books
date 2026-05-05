import { Camera, Images, Sparkles } from "lucide-react";
import Link from "next/link";

import HeroMotion from "./_components/HeroMotion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

const FEATURES = [
  {
    icon: Sparkles,
    title: "자동 편집",
    desc: "100장의 사진을 EXIF 촬영시각 기준으로 정렬하고, 한 번의 클릭으로 폴라로이드 페이지를 완성합니다.",
  },
  {
    icon: Camera,
    title: "폴라로이드 감성",
    desc: "기본 템플릿부터 2·3·4·6 분할 콜라주까지. 여백·타이포·그림자가 조화를 이루는 인스타 감성.",
  },
  {
    icon: Images,
    title: "고해상도 인쇄",
    desc: "300dpi · 2mm 재단선이 적용된 인쇄용 PDF를 자동 생성해 실제 책으로 만들어 배송합니다.",
  },
] as const;

export default function LandingPage() {
  return (
    <>
      {/* 히어로 */}
      <section className="relative overflow-hidden bg-hero-gradient">
        <div className="container flex flex-col items-start gap-8 py-16 md:py-24 lg:py-28">
          <HeroMotion>
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-rose-500/90">
              100 photos · 1 book
            </p>

            <h1 className="mt-4 max-w-[14ch] font-display text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
              100장의 순간,
              <br />한 권의 책.
            </h1>

            <p className="mt-6 max-w-[42ch] text-base leading-relaxed text-muted-foreground sm:text-lg">
              업로드 한 번으로 폴라로이드 감성 포토북을 만들고, 집 앞까지
              배송받으세요. 편집도 주문도 모두 모바일에서 한 번에.
            </p>

            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button
                asChild
                size="lg"
                variant="gradient"
                className="h-14 px-8 text-base sm:h-12 sm:text-base"
              >
                <Link href="/upload">지금 만들기</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-14 px-8 text-base sm:h-12 sm:text-base"
              >
                <Link href="#examples">예시 보기</Link>
              </Button>
            </div>
          </HeroMotion>
        </div>

        {/* 데코 — 접근성 무시 */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-20 size-72 rounded-full bg-gradient-to-br from-rose-200/70 to-amber-200/50 blur-3xl md:size-96"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-16 size-64 rounded-full bg-gradient-to-tr from-amber-200/60 to-rose-100/50 blur-3xl md:size-80"
        />
      </section>

      {/* 특징 */}
      <section id="examples" className="container py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            간결하지만, 디테일까지 완벽하게.
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            AI가 정렬하고 배치한 뒤, 당신은 감성만 얹으면 됩니다.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:mt-16 md:grid-cols-3 md:gap-6">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <Card key={title} className="h-full">
              <CardHeader>
                <div className="flex size-11 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="size-5" aria-hidden />
                </div>
                <CardTitle className="mt-4 font-display text-xl">
                  {title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-[15px] leading-relaxed">
                  {desc}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container pb-20 md:pb-28">
        <div className="overflow-hidden rounded-2xl border bg-gradient-to-br from-rose-50 via-amber-50 to-white p-8 shadow-soft dark:from-rose-950/30 dark:via-amber-950/20 dark:to-background md:p-12">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                이번 여행, 책으로 남겨보세요.
              </h3>
              <p className="mt-2 text-muted-foreground">
                지금 시작하면 3분 안에 첫 페이지가 완성됩니다.
              </p>
            </div>
            <Button asChild size="lg" variant="gradient" className="h-12 px-7">
              <Link href="/upload">사진 업로드하기</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
