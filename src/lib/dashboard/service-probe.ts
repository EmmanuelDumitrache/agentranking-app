import { validateProbeUrl } from "@/lib/endpoint-probe-url";
import { classifyDashboardServiceType } from "@/lib/dashboard/service-type";
import type { EndpointCheckResult } from "@/lib/dashboard/endpoint-health";
import { probeEndpoint } from "@/lib/dashboard/endpoint-health";
import { scanX402Endpoint } from "@/lib/dashboard/x402-scanner";
import { probeKindLabel, type ServiceProbeKind } from "@/lib/dashboard/service-display";
import { requestPublicHttp } from "@/lib/outbound-http";
export type { ServiceProbeKind };
export { probeKindLabel };
export type ServiceProbeResult = EndpointCheckResult & {
  checkType: ServiceProbeKind;
  skipped?: boolean;
  reason?: string;
};
type ServiceInput = {
  name: string;
  endpoint: string;
  x402Detected?: boolean;
};
function isHttpEndpoint(endpoint: string): boolean {
  const trimmed = endpoint.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}
function isA2aAgentCard(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  return (
    typeof record.name === "string" ||
    typeof record.description === "string" ||
    Array.isArray(record.skills) ||
    typeof record.url === "string"
  );
}
async function fetchJsonWithTiming(url: string, signal?: AbortSignal): Promise<{
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  json: unknown;
  error?: string;
}> {
  const started = Date.now();
  try {
    const res = await requestPublicHttp(url, {
      method: "GET",
      signal,
      timeoutMs: 12_000,
      maxResponseBytes: 262_144,
      maxRedirects: 3,
      allowHttp: true,
      headers: {
        Accept: "application/json",
        "User-Agent": "AgentRanking-Dashboard-Health/1.0",
      },
    });
    const text = res.body;
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: res.status >= 200 && res.status < 300 && !res.truncated,
      statusCode: res.status,
      latencyMs: Date.now() - started,
      json,
    };
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    return {
      ok: false,
      statusCode: null,
      latencyMs: Date.now() - started,
      json: null,
      error: Error.isError(err) ? err.message : "Probe failed",
    };
  }
}
async function probeA2aCard(endpoint: string, signal?: AbortSignal): Promise<ServiceProbeResult> {
  const validated = validateProbeUrl(endpoint);
  if (!validated.ok) {
    return {
      ok: false,
      statusCode: null,
      latencyMs: 0,
      error: validated.reason,
      checkType: "a2a_card",
      skipped: true,
      reason: validated.reason,
    };
  }
  const direct = await fetchJsonWithTiming(validated.url.toString(), signal);
  if (isA2aAgentCard(direct.json)) {
    return {
      ok: true,
      statusCode: direct.statusCode,
      latencyMs: direct.latencyMs,
      checkType: "a2a_card",
    };
  }
  const wellKnown = new URL("/.well-known/agent.json", validated.url);
  const card = await fetchJsonWithTiming(wellKnown.toString(), signal);
  if (isA2aAgentCard(card.json)) {
    return {
      ok: true,
      statusCode: card.statusCode,
      latencyMs: card.latencyMs,
      checkType: "a2a_card",
    };
  }
  return {
    ok: false,
    statusCode: card.statusCode ?? direct.statusCode,
    latencyMs: card.latencyMs || direct.latencyMs,
    error: direct.error ?? card.error ?? "No A2A agent card JSON found",
    checkType: "a2a_card",
  };
}
async function probeX402Service(endpoint: string, signal?: AbortSignal): Promise<ServiceProbeResult> {
  const scan = await scanX402Endpoint(endpoint, signal);
  return {
    ok: scan.reachable,
    statusCode: scan.statusCode,
    latencyMs: 0,
    error: scan.reachable ? undefined : scan.hints[0] ?? "x402 endpoint unreachable",
    checkType: "x402",
  };
}
export function resolveServiceProbeKind(service: ServiceInput): ServiceProbeKind {
  if (!service.endpoint.trim()) return "not_probeable";
  if (!isHttpEndpoint(service.endpoint)) return "not_probeable";
  const serviceType = classifyDashboardServiceType({
    name: service.name,
    endpoint: service.endpoint,
    x402Detected: service.x402Detected,
  });
  if (serviceType === "x402") return "x402";
  if (serviceType === "a2a") return "a2a_card";
  return "http";
}
export async function probeServiceByKind(service: ServiceInput, signal?: AbortSignal): Promise<ServiceProbeResult> {
  const kind = resolveServiceProbeKind(service);
  if (kind === "not_probeable") {
    return {
      ok: false,
      statusCode: null,
      latencyMs: 0,
      checkType: "not_probeable",
      skipped: true,
      reason: "Endpoint is not an HTTP URL",
    };
  }
  if (kind === "a2a_card") {
    return probeA2aCard(service.endpoint, signal);
  }
  if (kind === "x402") {
    return probeX402Service(service.endpoint, signal);
  }
  const http = await probeEndpoint(service.endpoint, signal);
  return { ...http, checkType: "http" };
}
