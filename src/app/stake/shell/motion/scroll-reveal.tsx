"use client";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import {
  fadeUp,
  STAKE_SITE_EASE,
  STAKE_SITE_VIEWPORT,
} from "@/app/stake/shell/motion/motion-variants";
import { cn } from "@/lib/utils";
export function ScrollReveal({
  children,
  className,
  delay = 0,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={cn(className)}
      initial="hidden"
      whileInView="visible"
      viewport={STAKE_SITE_VIEWPORT}
      variants={fadeUp}
      transition={{ duration: 0.55, ease: STAKE_SITE_EASE, delay }}
    >
      {children}
    </motion.div>
  );
}
