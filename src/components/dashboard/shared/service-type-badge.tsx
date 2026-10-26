import {
  classifyDashboardServiceType,
  dashboardServiceTypeLabel,
  type DashboardServiceType,
} from "@/lib/dashboard/service-type";
import { cn } from "@/lib/utils";
const STYLES: Record<DashboardServiceType, string> = {
  website: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  api: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  mcp: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  a2a: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  x402: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  docs: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  custom: "border-border bg-muted/50 text-muted-foreground",
};
type Props = {
  name: string;
  endpoint: string;
  x402Detected?: boolean;
  type?: DashboardServiceType;
  className?: string;
};
export function DashboardServiceTypeBadge({
  name,
  endpoint,
  x402Detected,
  type,
  className,
}: Props) {
  const resolved =
    type ?? classifyDashboardServiceType({ name, endpoint, x402Detected });
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STYLES[resolved],
        className,
      )}
    >
      {dashboardServiceTypeLabel(resolved)}
    </span>
  );
}
