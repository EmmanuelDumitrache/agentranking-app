import {
  resolveServiceHealth,
  type ResolvedServiceHealth,
  type ServiceHealthStatus,
} from "@/lib/dashboard/service-health";
export type PublicHealthSignal = {
  signalType: string;
  status: string;
  value: string;
  payloadJson: unknown;
  lastCheckedAt: string | null;
  expiresAt?: string | null;
};
function toSignalRows(signals: PublicHealthSignal[]) {
  return signals.map((s) => ({
    signalType: s.signalType,
    status: s.status,
    value: s.value,
    payloadJson: s.payloadJson,
    lastCheckedAt: s.lastCheckedAt ? new Date(s.lastCheckedAt) : null,
    expiresAt: s.expiresAt ? new Date(s.expiresAt) : null,
  }));
}
const WORST_RANK: Record<ServiceHealthStatus, number> = {
  live: 0,
  unknown: 1,
  stale: 2,
  failing: 3,
};
export function publicServiceHealthLabel(status: ServiceHealthStatus): string {
  switch (status) {
    case "live":
      return "Live";
    case "failing":
      return "Failing";
    case "stale":
      return "Stale";
    case "unknown":
      return "Unknown";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
export function publicHealthBadgeClass(status: ServiceHealthStatus): string {
  switch (status) {
    case "live":
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "failing":
      return "border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-400";
    case "stale":
      return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "unknown":
      return "border-border bg-muted/30 text-muted-foreground";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
export function resolveGroupedServiceHealth(
  serviceIds: number[],
  names: string[],
  endpoint: string,
  signals: PublicHealthSignal[],
): ResolvedServiceHealth {
  const rows = toSignalRows(signals);
  if (serviceIds.length === 0) {
    return resolveServiceHealth(0, names[0] ?? "", endpoint, rows);
  }
  let worst: ServiceHealthStatus = "live";
  let best: ResolvedServiceHealth | null = null;
  for (let i = 0; i < serviceIds.length; i++) {
    const resolved = resolveServiceHealth(
      serviceIds[i]!,
      names[i] ?? names[0] ?? "",
      endpoint,
      rows,
    );
    if (!best || WORST_RANK[resolved.status] > WORST_RANK[worst]) {
      worst = resolved.status;
      best = resolved;
    }
  }
  return best ?? resolveServiceHealth(serviceIds[0]!, names[0] ?? "", endpoint, rows);
}
