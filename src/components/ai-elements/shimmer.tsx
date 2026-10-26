"use client";
import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import { memo, useMemo } from "react";
export interface TextShimmerProps {
  children: string;
  className?: string;
  duration?: number;
  spread?: number;
}
const ShimmerComponent = ({
  children,
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const dynamicSpread = useMemo(
    () => (children?.length ?? 0) * spread,
    [children, spread],
  );
  const shouldReduceMotion = useReducedMotion();
  return (
    <motion.p
      animate={
        shouldReduceMotion ? undefined : { backgroundPosition: "0% center" }
      }
      className={cn(
        shouldReduceMotion
          ? "relative inline-block text-muted-foreground"
          : "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className,
      )}
      initial={
        shouldReduceMotion ? false : { backgroundPosition: "100% center" }
      }
      style={
        shouldReduceMotion
          ? undefined
          : ({
              "--spread": `${dynamicSpread}px`,
              backgroundImage:
                "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
            } as CSSProperties)
      }
      transition={
        shouldReduceMotion
          ? undefined
          : {
              duration,
              ease: "linear",
              repeat: Number.POSITIVE_INFINITY,
            }
      }
    >
      {children}
    </motion.p>
  );
};
export const Shimmer = memo(ShimmerComponent);
