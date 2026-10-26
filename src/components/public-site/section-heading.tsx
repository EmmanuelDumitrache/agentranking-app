"use client";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import styles from "@/components/public-site/public-feature-page.module.css";
export type PublicSectionAccent = "emerald" | "amber" | "blue";
const ACCENT_EYEBROW: Record<PublicSectionAccent, string> = {
  emerald: "text-emerald-400/90",
  amber: "text-amber-400/90",
  blue: "text-blue-400/90",
};
const ACCENT_GRADIENT: Record<PublicSectionAccent, string> = {
  emerald: "from-foreground via-emerald-300 to-foreground",
  amber: "from-foreground via-amber-300 to-foreground",
  blue: "from-foreground via-blue-300 to-foreground",
};
const ACCENT_SHIMMER: Record<PublicSectionAccent, string> = {
  emerald: "text-emerald-300",
  amber: "text-amber-300",
  blue: "text-blue-300",
};
export function PublicSectionHeading({
  eyebrow,
  title,
  titleHighlight,
  subtitle,
  accent = "emerald",
  align = "center",
  className,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly titleHighlight?: string;
  readonly subtitle?: string;
  readonly accent?: PublicSectionAccent;
  readonly align?: "center" | "left";
  readonly className?: string;
}) {
  const alignClass =
    align === "center"
      ? "text-left sm:text-center mx-auto"
      : "text-left";
  return (
    <div className={cn(alignClass, "max-w-3xl", className)}>
      <p className={cn("text-xs font-semibold uppercase tracking-widest", ACCENT_EYEBROW[accent])}>
        {eyebrow}
      </p>
      <h2
        className={cn(
          "mt-2 text-2xl font-bold tracking-tight text-balance md:text-4xl",
          `bg-gradient-to-r ${ACCENT_GRADIENT[accent]} bg-clip-text text-transparent`,
          styles.titleGradientShift,
        )}
      >
        {titleHighlight ? (
          <>
            {title}{" "}
            <TextShimmer as="span" className={ACCENT_SHIMMER[accent]}>
              {titleHighlight}
            </TextShimmer>
          </>
        ) : (
          title
        )}
      </h2>
      {subtitle ? (
        <p
          className={cn(
            "mt-3 text-sm text-muted-foreground md:text-base leading-relaxed",
            alignClass,
          )}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
