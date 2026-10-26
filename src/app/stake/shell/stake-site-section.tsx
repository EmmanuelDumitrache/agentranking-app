"use client";
import { useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { ScrollReveal } from "@/app/stake/shell/motion/scroll-reveal";
import { cn } from "@/lib/utils";
export function StakeSiteSection({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
  compact,
  subtle,
  narrow,
  centered,
  reveal = true,
  revealContent,
}: {
  readonly id?: string;
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly compact?: boolean;
  /** No top border — for alternating rhythm */
  readonly subtle?: boolean;
  /** Narrower heading column for editorial sections */
  readonly narrow?: boolean;
  /** Center section heading and body */
  readonly centered?: boolean;
  /** Animate section on scroll (respects reduced motion). */
  readonly reveal?: boolean;
  /** Fade up section body on scroll — disable when children use their own stagger. */
  readonly revealContent?: boolean;
}) {
  const reduce = useReducedMotion();
  const showReveal = reveal && !reduce;
  const showContentReveal = showReveal && revealContent !== false;
  const bodySpacing = description || eyebrow ? "mt-6 sm:mt-7" : "";
  const header = (
    <div className={cn(centered && "mx-auto max-w-2xl text-center")}>
      {eyebrow ? <p className="ar-public-label mb-2.5">{eyebrow}</p> : null}
      <h2 className={cn("ar-public-section-title", narrow && "max-w-xl", centered && "mx-auto max-w-lg")}>
        {title}
      </h2>
      {description ? (
        <p
          className={cn(
            "mt-2.5 max-w-xl text-[13px] leading-[1.5] text-[var(--ar-text-secondary)]",
            narrow && "max-w-lg",
            centered && "mx-auto max-w-md",
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
  return (
    <section
      id={id}
      className={cn(
        !subtle && "border-t border-[var(--ar-border)]",
        compact ? "py-10 sm:py-12" : "py-12 sm:py-14 lg:py-[var(--ar-public-section-pad)]",
        className,
      )}
    >
      <div className="ar-public-container">
        {showReveal ? <ScrollReveal>{header}</ScrollReveal> : header}
        <div className={cn(bodySpacing, centered && "flex flex-col items-center")}>
          {showContentReveal ? <ScrollReveal delay={0.08}>{children}</ScrollReveal> : children}
        </div>
      </div>
    </section>
  );
}
