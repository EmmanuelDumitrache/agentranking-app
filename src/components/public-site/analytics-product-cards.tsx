"use client";
import { BarChart3, Database, FileSpreadsheet, LineChart, Network, Radio } from "lucide-react";
import type { AnalyticsDataProduct } from "@/lib/analytics-preview-data";
import { cn } from "@/lib/utils";
import styles from "@/components/public-site/public-feature-page.module.css";
const PRODUCT_ICONS: Record<string, typeof LineChart> = {
  "registry-pulse": Radio,
  "capability-graph": Network,
  "reputation-signals": BarChart3,
  "demand-index": LineChart,
  "private-api": Database,
  "enterprise-export": FileSpreadsheet,
};
function formatBadge(format: string) {
  return format;
}
export function AnalyticsProductCards({
  products,
  className,
}: {
  readonly products: readonly AnalyticsDataProduct[];
  readonly className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {products.map((product) => {
        const Icon = PRODUCT_ICONS[product.id] ?? LineChart;
        return (
          <article
            key={product.id}
            className={cn(
              "flex flex-col rounded-2xl border border-border bg-card/50 p-4 sm:p-5",
              styles.cardShine,
            )}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-blue-500/25 bg-blue-500/10">
              <Icon className="h-4 w-4 text-blue-300" aria-hidden />
            </span>
            <h3 className="mt-3 text-sm font-semibold text-foreground">{product.name}</h3>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">{product.tagline}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {product.formats.map((f) => (
                <span
                  key={f}
                  className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {formatBadge(f)}
                </span>
              ))}
            </div>
            <dl className="mt-3 space-y-1 border-t border-border/60 pt-3 text-[10px] text-muted-foreground">
              <div className="flex justify-between gap-2">
                <dt>Buyer</dt>
                <dd className="text-right text-foreground/80">{product.buyer}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Refresh</dt>
                <dd className="text-right text-foreground/80">{product.refresh}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Access</dt>
                <dd className="text-right font-medium text-blue-300/90">{product.access}</dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}
