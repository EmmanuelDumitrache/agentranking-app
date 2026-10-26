import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
export function ScannerCell({
  children,
  className,
  align = "left",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly align?: "left" | "right" | "center";
}) {
  return (
    <div
      className={cn(
        "scanner-grid-cell",
        align === "right" && "scanner-grid-cell--right",
        align === "center" && "scanner-grid-cell--center",
        className,
      )}
    >
      {children}
    </div>
  );
}
export function ScannerMetricCell({
  value,
  empty = false,
  accent,
  title,
  className,
}: {
  readonly value: ReactNode;
  readonly empty?: boolean;
  readonly accent?: "success" | "accent" | "default";
  readonly title?: string;
  readonly className?: string;
}) {
  let tone = "text-[var(--ar-text-secondary)]";
  if (empty) {
    tone = "text-[var(--ar-text-muted)] opacity-50";
  } else if (accent === "success") {
    tone = "text-[var(--ar-success)]";
  } else if (accent === "accent") {
    tone = "text-[var(--ar-accent)]";
  }
  return (
    <ScannerCell align="right">
      <span title={title} className={cn("scanner-metric font-medium", empty ? tone : cn(tone, className))}>
        {value}
      </span>
    </ScannerCell>
  );
}