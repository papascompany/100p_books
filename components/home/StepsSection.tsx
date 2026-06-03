"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { ArrowRight, Upload, Wand2, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

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

/* ─── Animation Variants ──────────────────────────────────────────────────── */

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.2, delayChildren: 0.1 },
  },
};

const headingVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  },
};

const lineVariants = {
  hidden: { scaleX: 0 },
  visible: {
    scaleX: 1,
    transition: { duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.35 },
  },
};

const badgeVariants = {
  hidden: { scale: 0.6, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: { type: "spring", stiffness: 260, damping: 18, delay: 0.1 },
  },
};

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function StepsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.25 });

  return (
    <section
      ref={sectionRef}
      className="relative py-12 md:py-20 bg-night overflow-hidden"
    >
      {/* 배경 텍스처 그라디언트 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,107,94,0.05) 0%, transparent 70%)",
        }}
      />

      <div className="container relative z-10">
        {/* 헤더 */}
        <motion.div
          className="mx-auto max-w-xl text-center mb-12"
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
        >
          <motion.p
            variants={headingVariants}
            className="text-xs font-semibold uppercase tracking-[0.25em] text-white/30 mb-3"
          >
            How it works
          </motion.p>
          <motion.h2
            variants={headingVariants}
            className="text-2xl font-bold tracking-tight text-white md:text-3xl"
          >
            3분 만에 완성되는 포토북
          </motion.h2>
          <motion.p
            variants={headingVariants}
            className="mt-2 text-sm text-white/40"
          >
            세 단계만 거치면 나만의 감성 포토북이 완성돼요.
          </motion.p>
        </motion.div>

        {/* Steps Grid */}
        <div className="relative">
          {/* 데스크탑 연결선 */}
          <div className="hidden md:block absolute top-[52px] left-[calc(16.66%+40px)] right-[calc(16.66%+40px)] h-px bg-white/8 overflow-hidden">
            <motion.div
              className="h-full origin-left"
              style={{
                background:
                  "linear-gradient(90deg, #FF6B5E 0%, #FFD9D2 50%, #FFB23E 100%)",
              }}
              variants={lineVariants}
              initial="hidden"
              animate={isInView ? "visible" : "hidden"}
            />
          </div>

          {/* 모바일 수직 연결선 */}
          <div className="md:hidden absolute left-6 top-[52px] bottom-[52px] w-px bg-white/8 overflow-hidden">
            <motion.div
              className="w-full origin-top"
              style={{
                background:
                  "linear-gradient(180deg, #FF6B5E 0%, #FFD9D2 50%, #FFB23E 100%)",
              }}
              variants={{
                hidden: { scaleY: 0 },
                visible: {
                  scaleY: 1,
                  transition: { duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.4 },
                },
              }}
              initial="hidden"
              animate={isInView ? "visible" : "hidden"}
            />
          </div>

          <motion.div
            className="grid gap-6 md:grid-cols-3"
            variants={containerVariants}
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
          >
            {STEPS.map(({ num, icon: Icon, title, desc, accent, glow, border }) => (
              <motion.div
                key={num}
                variants={cardVariants}
                whileHover={{ y: -8, transition: { duration: 0.3 } }}
                className="relative pl-16 md:pl-0 md:flex md:flex-col md:items-center md:text-center group cursor-default"
              >
                {/* 번호 배지 */}
                <motion.div
                  variants={badgeVariants}
                  className="relative mb-5 flex-shrink-0"
                  style={{ alignSelf: "flex-start" }}
                >
                  {/* Outer glow ring — animates on hover */}
                  <motion.div
                    className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{
                      background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`,
                      transform: "scale(2.2)",
                    }}
                  />
                  {/* Animated border ring */}
                  <motion.div
                    className="absolute -inset-2 rounded-full border opacity-0 group-hover:opacity-100 transition-all duration-500 group-hover:scale-110"
                    style={{ borderColor: border }}
                    initial={{ scale: 0.85 }}
                  />
                  {/* Badge body */}
                  <div
                    className="relative z-10 flex size-[80px] items-center justify-center rounded-full border"
                    style={{
                      background: `linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)`,
                      borderColor: "rgba(255,255,255,0.1)",
                    }}
                  >
                    {/* Decorative large faded number */}
                    <span
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
                      className="relative z-10 size-7 transition-transform duration-300 group-hover:scale-110"
                      style={{ color: accent }}
                    />
                  </div>

                  {/* Step number label */}
                  <div
                    className="absolute -top-1 -right-1 z-20 flex size-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: accent }}
                  >
                    {parseInt(num, 10)}
                  </div>
                </motion.div>

                {/* 카드 본문 */}
                <div
                  className="relative rounded-none border p-5 transition-all duration-500 group-hover:border-opacity-60"
                  style={{
                    borderColor: "rgba(255,255,255,0.07)",
                    background:
                      "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
                  }}
                >
                  {/* 호버 시 coral accent 그라디언트 상단 라인 */}
                  <motion.div
                    className="absolute inset-x-0 top-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
                  />

                  {/* 배경 대형 숫자 (장식) */}
                  <span
                    className="font-display-num absolute bottom-2 right-3 text-[64px] font-bold leading-none select-none pointer-events-none transition-opacity duration-300 group-hover:opacity-[0.08]"
                    style={{ color: accent, opacity: 0.04 }}
                  >
                    {num}
                  </span>

                  <h3 className="relative text-base font-bold text-white mb-2">{title}</h3>
                  <p className="relative text-sm text-white/45 leading-relaxed">{desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* CTA */}
        <motion.div
          className="mt-10 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <Button
            asChild
            size="lg"
            className="bg-coral text-white hover:bg-coral-600 border-0 font-semibold shadow-coral-glow"
          >
            <Link href="/upload">
              지금 시작하기
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
