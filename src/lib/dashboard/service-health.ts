export type ServiceHealthStatus = "live" | "failing" | "stale" | "unknown";
export type ServiceHealthSource = "manual" | "scheduled";
type StoredServiceHealthSource = ServiceHealthSource | "cron";
export type ServiceHealthEntry = {
  serviceId: number;
  serviceName: string;
  endpoint: string;
  status: ServiceHealthStatus;
  statusCode: number | null;
  latencyMs: number | null;
  error?: string;
  source: ServiceHealthSource;
  checkType?: string;
  lastCheckedAt: string;
};
export type ResolvedServiceHealth = {
  status: ServiceHealthStatus;
  lastCheckedAt: Date | null;
  httpStatus: number | null;
  responseTimeMs: number | null;
  error: string | null;
  source: ServiceHealthSource | null;
  checkType: string | null;
};
type HealthPayload = {
  serviceName?: string;
  endpoint?: string;
  serviceId?: number;
  statusCode?: number | null;
  latencyMs?: number;
  error?: string;
  source?: StoredServiceHealthSource;
  checkType?: string;
  checks?: Record<string, Omit<ServiceHealthEntry, "source"> & { source: StoredServiceHealthSource }>;
};
export type ServiceHealthSignalRow = {
  signalType: string;
  status: string;
  value: string;
  payloadJson: unknown;
  lastCheckedAt: Date | null;
  expiresAt?: Date | null;
};
function normalizeEndpoint(url: string): string {
  return url.trim().toLowerCase().replace(/\/$/, "");
}
function parsePayload(payload: unknown): HealthPayload | null {
  if (!payload || typeof payload !== "object") return null;
  return payload as HealthPayload;
}
function normalizeHealthSource(source: StoredServiceHealthSource | undefined): ServiceHealthSource | undefined {
  if (source === "cron") return "scheduled";
  return source;
}
function normalizeStoredEntry(
  entry: Omit<ServiceHealthEntry, "source"> & { source: StoredServiceHealthSource },
): ServiceHealthEntry {
  return { ...entry, source: normalizeHealthSource(entry.source) ?? "scheduled" };
}
function entryToResolved(entry: ServiceHealthEntry, signalExpiresAt?: Date | null): ResolvedServiceHealth {
  let status = entry.status;
  if (signalExpiresAt && signalExpiresAt < new Date()) {
    status = "stale";
  }
  return {
    status,
    lastCheckedAt: new Date(entry.lastCheckedAt),
    httpStatus: entry.statusCode,
    responseTimeMs: entry.latencyMs,
    error: entry.error ?? null,
    source: entry.source,
    checkType: entry.checkType ?? null,
  };
}
function signalMatchesService(
  signalValue: string,
  payload: HealthPayload | null,
  serviceName: string,
  endpoint: string,
): boolean {
  const normEndpoint = normalizeEndpoint(endpoint);
  if (payload?.endpoint && normalizeEndpoint(payload.endpoint) === normEndpoint) {
    if (!payload.serviceName || payload.serviceName === serviceName) return true;
  }
  const expected = `${serviceName}:${endpoint}`;
  if (signalValue === expected) return true;
  if (signalValue.endsWith(`:${endpoint}`)) return true;
  return false;
}
export function collectServiceHealthChecks(
  signals: ServiceHealthSignalRow[],
): Record<string, ServiceHealthEntry> {
  const merged: Record<string, ServiceHealthEntry> = {};
  for (const sig of signals) {
    const payload = parsePayload(sig.payloadJson);
    if (!payload?.checks) continue;
    for (const [key, entry] of Object.entries(payload.checks)) {
      merged[key] = normalizeStoredEntry(entry);
    }
  }
  return merged;
}
export function resolveServiceHealth(
  serviceId: number,
  serviceName: string,
  endpoint: string,
  signals: ServiceHealthSignalRow[],
): ResolvedServiceHealth {
  const live = signals.find((s) => s.signalType === "endpoint_live");
  const failing = signals.find((s) => s.signalType === "endpoint_failing");
  const allChecks = collectServiceHealthChecks([live, failing].filter(Boolean) as ServiceHealthSignalRow[]);
  const key = String(serviceId);
  if (allChecks[key]) {
    const parent = live?.payloadJson ? live : failing;
    return entryToResolved(allChecks[key], parent?.expiresAt);
  }
  for (const sig of [live, failing].filter(Boolean) as ServiceHealthSignalRow[]) {
    if (!signalMatchesService(sig.value, parsePayload(sig.payloadJson), serviceName, endpoint)) {
      continue;
    }
    const payload = parsePayload(sig.payloadJson);
    if (!payload) continue;
    let status: ServiceHealthStatus = "unknown";
    if (sig.status === "stale" || (sig.expiresAt && sig.expiresAt < new Date())) {
      status = "stale";
    } else if (sig.signalType === "endpoint_live") {
      status = "live";
    } else if (sig.signalType === "endpoint_failing") {
      status = "failing";
    }
    return {
      status,
      lastCheckedAt: sig.lastCheckedAt,
      httpStatus: payload.statusCode ?? null,
      responseTimeMs: payload.latencyMs ?? null,
      error: payload.error ?? null,
      source: normalizeHealthSource(payload.source) ?? null,
      checkType: payload.checkType ?? normalizeHealthSource(payload.source) ?? null,
    };
  }
  return {
    status: "unknown",
    lastCheckedAt: null,
    httpStatus: null,
    responseTimeMs: null,
    error: null,
    source: null,
    checkType: null,
  };
}
