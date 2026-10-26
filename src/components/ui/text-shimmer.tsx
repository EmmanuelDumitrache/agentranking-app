"use client";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";
const MOTION_TAGS = {
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  p: motion.p,
  span: motion.span,
} as const;
type MotionTag = keyof typeof MOTION_TAGS;
function StaticText({
  tag,
  className,
  children,
}: Readonly<{
  tag: MotionTag;
  className: string;
  children: string;
}>) {
  switch (tag) {
    case "h1":
      return <h1 className={className}>{children}</h1>;
    case "h2":
      return <h2 className={className}>{children}</h2>;
    case "h3":
      return <h3 className={className}>{children}</h3>;
    case "p":
      return <p className={className}>{children}</p>;
    case "span":
      return <span className={className}>{children}</span>;
    default: {
      const exhaustive: never = tag;
      return exhaustive;
    }
  }
}
export interface TextShimmerProps {
  readonly children: string;
  readonly as?: MotionTag;
  readonly className?: string;
  readonly duration?: number;
  readonly spread?: number;
}
export function TextShimmer({
  children,
  as: tag = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) {
  const reduceMotion = useReducedMotion();
  const dynamicSpread = useMemo(() => children.length * spread, [children, spread]);
  const shimmerClass = cn(
    "relative inline-block bg-[length:250%_100%,auto] bg-clip-text",
    "text-transparent [--base-color:#a1a1aa] [--base-gradient-color:#000]",
    "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
    "dark:[--base-color:#71717a] dark:[--base-gradient-color:#ffffff] dark:[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]",
    className
  );
  const shimmerStyle = {
    "--spread": `${dynamicSpread}px`,
    backgroundImage: `var(--bg), linear-gradient(var(--base-color), var(--base-color))`,
  } as ComponentPropsWithoutRef<"span">["style"];
  if (reduceMotion) {
    return (
      <StaticText
        tag={tag}
        className={cn("text-foreground", className)}
      >
        {children}
      </StaticText>
    );
  }
  const MotionComponent = MOTION_TAGS[tag];
  return (
    <MotionComponent
      className={shimmerClass}
      initial={{ backgroundPosition: "100% center" }}
      animate={{ backgroundPosition: "0% center" }}
      transition={{
        repeat: Infinity,
        duration,
        ease: "linear",
      }}
      style={shimmerStyle}
    >
      {children}
    </MotionComponent>
  );
}
