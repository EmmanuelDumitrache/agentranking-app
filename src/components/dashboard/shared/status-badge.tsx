import { cn } from "@/lib/utils";
export type DashboardStatusBadgeVariant =
  | "available"
  | "coming_soon"
  | "requires_verification"
  | "setup"
  | "configure"
  | "no_data"
  | "connect_first"
  | "connected"
  | "not_connected"
  | "live"
  | "failing"
  | "stale"
  | "verified"
  | "unverified";
const LABELS: Record<DashboardStatusBadgeVariant, string> = {
  available: "Available",
  coming_soon: "Coming soon",
  requires_verification: "Requires verified agent",
  setup: "Setup",
  configure: "Configure",
  no_data: "No data yet",
  connect_first: "Connect first",
  connected: "Connected",
  not_connected: "Not connected",
  live: "Live",
  failing: "Failing",
  stale: "Stale",
  verified: "Verified",
  unverified: "Unverified",
};
const PILL_CLASS: Record<DashboardStatusBadgeVariant, string> = {
  available: "ui-pill ui-pill--ok",
  coming_soon: "ui-pill",
  requires_verification: "ui-pill ui-pill--gold",
  setup: "ui-pill ui-pill--info",
  configure: "ui-pill ui-pill--info",
  no_data: "ui-pill",
  connect_first: "ui-pill ui-pill--gold",
  connected: "ui-pill ui-pill--ok",
  not_connected: "ui-pill",
  live: "ui-pill ui-pill--ok",
  failing: "ui-pill ui-pill--danger",
  stale: "ui-pill ui-pill--gold",
  verified: "ui-pill ui-pill--gold",
  unverified: "ui-pill ui-pill--gold",
};
type Props = {
  variant: DashboardStatusBadgeVariant;
  label?: string;
  className?: string;
};
export function DashboardStatusBadge({ variant, label, className }: Props) {
  return (
    <span className={cn(PILL_CLASS[variant], className)}>
      {label ?? LABELS[variant]}
    </span>
  );
}
