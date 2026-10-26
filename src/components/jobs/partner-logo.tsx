"use client";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { getJobPartnerBrand } from "@/lib/jobs/partners/branding";
type LogoVariant = "icon" | "wordmark";
type LogoSize = "xs" | "sm" | "md" | "lg";
type Props = {
  readonly source: string;
  readonly variant?: LogoVariant;
  readonly size?: LogoSize;
  readonly className?: string;
  readonly showName?: boolean;
  readonly priority?: boolean;
};
const ICON_PX: Record<LogoSize, number> = {
  xs: 20,
  sm: 24,
  md: 32,
  lg: 40,
};
const WORDMARK_HEIGHT_PX: Record<LogoSize, number> = {
  xs: 18,
  sm: 22,
  md: 28,
  lg: 36,
};
const WORDMARK_WIDTH_PX: Record<LogoSize, number> = {
  xs: 72,
  sm: 88,
  md: 112,
  lg: 140,
};
const TEXT_SIZE: Record<LogoSize, string> = {
  xs: "text-[10px]",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};
/** Neutralize global `* { border-border outline-ring/50 }` on logo images. */
const IMAGE_RESET =
  "border-0 outline-none ring-0 focus-visible:outline-none shrink-0 object-contain";
export function PartnerLogo({
  source,
  variant = "icon",
  size = "sm",
  className,
  showName = false,
  priority = false,
}: Props) {
  const brand = getJobPartnerBrand(source);
  const alt = brand ? `${brand.displayName} logo` : `${source} partner logo`;
  const iconPx = ICON_PX[size];
  if (!brand) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md border border-border bg-muted font-semibold uppercase",
          TEXT_SIZE[size],
          className,
        )}
        style={{ width: iconPx, height: iconPx }}
        aria-label={alt}
      >
        {source.slice(0, 2)}
      </span>
    );
  }
  if (variant === "wordmark" && brand.wordmarkUrl) {
    return (
      <span className={cn("inline-flex min-w-0 items-center", className)}>
        <Image
          src={brand.wordmarkUrl}
          alt={alt}
          width={WORDMARK_WIDTH_PX[size]}
          height={WORDMARK_HEIGHT_PX[size]}
          priority={priority}
          className={cn(IMAGE_RESET, "w-auto object-contain object-left")}
          style={{ height: WORDMARK_HEIGHT_PX[size] }}
        />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Image
        src={brand.logoUrl}
        alt={showName ? "" : alt}
        width={iconPx}
        height={iconPx}
        priority={priority}
        aria-hidden={showName || undefined}
        className={cn(IMAGE_RESET, "rounded-md")}
      />
      {showName ? (
        <span
          className={cn(
            "min-w-0 truncate font-semibold leading-tight text-foreground",
            TEXT_SIZE[size],
          )}
        >
          {brand.displayName}
        </span>
      ) : null}
    </span>
  );
}