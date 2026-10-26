import type { PublicSiteHomeStats } from "@/lib/public-site/home-types";
import {
  formatCompactPlus,
  formatInteger,
} from "@/lib/public-platform-stats";
import { cn } from "@/lib/utils";
type Props = {
  readonly stats: PublicSiteHomeStats;
  readonly tokenLaunchCount: number;
  readonly nativeAgentCount: number;
  readonly className?: string;
};
function MetricCell({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="ui-public-site-card flex flex-col p-3 text-center sm:text-left">
      <p className="text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">{value}</p>
      <p className="text-muted-foreground mt-1 text-[10px] font-medium tracking-wide uppercase">
        {label}
      </p>
    </div>
  );
}
/** Single metrics band — Agents indexed, Chains, AR Tokens, Deployed agents. */
export function PublicSiteMetrics({
  stats,
  tokenLaunchCount,
  nativeAgentCount,
  className,
}: Props) {
  const items = [
    { label: "Agents indexed", value: formatCompactPlus(stats.totalAgents) },
    { label: "Chains", value: formatInteger(stats.totalChains) },
    {
      label: "AR Tokens",
      value: tokenLaunchCount > 0 ? formatInteger(tokenLaunchCount) : "—",
    },
    {
      label: "Deployed agents",
      value: nativeAgentCount > 0 ? formatInteger(nativeAgentCount) : "—",
    },
  ];
  return (
    <section
      className={cn("border-t border-border/50 py-6 sm:py-8", className)}
      aria-label="Platform metrics"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((item) => (
          <MetricCell key={item.label} label={item.label} value={item.value} />
        ))}
      </div>
    </section>
  );
}
