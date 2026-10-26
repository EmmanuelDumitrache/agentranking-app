import { prisma } from "@/lib/db";
import type { EndpointCheckResult } from "@/lib/dashboard/endpoint-health";
import { upsertAgentSignals } from "@/lib/signals/store";
import type { DerivedSignal } from "@/lib/signals/types";
import {
  collectServiceHealthChecks,
  type ServiceHealthEntry,
  type ServiceHealthSource,
  type ServiceHealthStatus,
} from "@/lib/dashboard/service-health";
export async function mergeServiceHealthCheck(
  agentId: number,
  serviceId: number,
  serviceName: string,
  endpoint: string,
  result: EndpointCheckResult,
  source: ServiceHealthSource,
  checkType?: string,
): Promise<void> {
  const now = new Date();
  const status: ServiceHealthStatus = result.ok ? "live" : "failing";
  const entry: ServiceHealthEntry = {
    serviceId,
    serviceName,
    endpoint,
    status,
    statusCode: result.statusCode,
    latencyMs: result.latencyMs,
    error: result.error,
    source,
    checkType,
    lastCheckedAt: now.toISOString(),
  };
  const [existingLive, existingFailing] = await Promise.all([
    prisma.agentVerificationSignal.findUnique({
      where: { agentId_signalType: { agentId, signalType: "endpoint_live" } },
    }),
    prisma.agentVerificationSignal.findUnique({
      where: { agentId_signalType: { agentId, signalType: "endpoint_failing" } },
    }),
  ]);
  const allChecks = collectServiceHealthChecks(
    [existingLive, existingFailing].filter(Boolean) as Parameters<
      typeof collectServiceHealthChecks
    >[0],
  );
  allChecks[String(serviceId)] = entry;
  const liveChecks: Record<string, ServiceHealthEntry> = {};
  const failingChecks: Record<string, ServiceHealthEntry> = {};
  for (const [key, check] of Object.entries(allChecks)) {
    if (check.status === "live") liveChecks[key] = check;
    if (check.status === "failing") failingChecks[key] = check;
  }
  const basePayload = {
    serviceId,
    serviceName,
    endpoint,
    statusCode: result.statusCode,
    latencyMs: result.latencyMs,
    error: result.error,
    source,
    checkType,
  };
  const signals: DerivedSignal[] = [];
  if (Object.keys(liveChecks).length > 0) {
    signals.push({
      signalType: "endpoint_live",
      status: "verified",
      source: "endpoint_check",
      confidence: "high",
      value: `${serviceName}:${endpoint}`,
      payloadJson: { ...basePayload, checks: liveChecks },
      lastCheckedAt: now,
      verifiedAt: result.ok ? now : existingLive?.verifiedAt ?? undefined,
    });
  }
  if (Object.keys(failingChecks).length > 0) {
    const lastFailing = failingChecks[String(serviceId)] ?? Object.values(failingChecks).at(-1)!;
    signals.push({
      signalType: "endpoint_failing",
      status: "failed",
      source: "endpoint_check",
      confidence: "high",
      value: `${lastFailing.serviceName}:${lastFailing.endpoint}`,
      payloadJson: {
        serviceId: lastFailing.serviceId,
        serviceName: lastFailing.serviceName,
        endpoint: lastFailing.endpoint,
        statusCode: lastFailing.statusCode,
        latencyMs: lastFailing.latencyMs,
        error: lastFailing.error,
        source: lastFailing.source,
        checks: failingChecks,
      },
      lastCheckedAt: now,
    });
  }
  if (signals.length > 0) {
    await upsertAgentSignals(agentId, signals);
  }
}
