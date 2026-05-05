"use client";

import { motion, useReducedMotion } from "framer-motion";
import * as React from "react";

/**
 * 히어로 섹션의 fade/slide-in 애니메이션 래퍼.
 * prefers-reduced-motion 시 모션을 끈다.
 */
export default function HeroMotion({
  children,
}: {
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="w-full"
    >
      {children}
    </motion.div>
  );
}
