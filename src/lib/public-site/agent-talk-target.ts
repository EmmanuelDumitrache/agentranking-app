import {
  resolveServiceHealth,
  type ServiceHealthSignalRow,
} from "@/lib/dashboard/service-health";

export type AgentTalkServiceLike = {
  readonly id: number;
  readonly name: string;
  readonly endpoint: string;
  readonly normalizedType: string | null;
  readonly endpointKind: string | null;
  readonly endpointValid: boolean | null;
};

export type AgentTalkTarget =
  | {
      readonly status: "live";
      readonly serviceId: number;
      readonly serviceName: string;
      readonly endpoint: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason: string;
      readonly serviceName: string | null;
    };

const TALK_NORMALIZED_TYPES = new Set(["http", "web", "a2a"]);

function includesMcpToken(value: string | null | undefined): boolean {
  return /\bmcp\b|model context protocol/i.test(value ?? "");
}

function isTalkServiceCandidate(service: AgentTalkServiceLike): boolean {
  if (service.endpointKind !== "https") return false;
  if (service.endpointValid !== true) return false;
  const endpoint = service.endpoint?.trim() ?? "";
  if (!endpoint.startsWith("https://")) return false;
  const normalizedType = (service.normalizedType ?? "").trim().toLowerCase();
  if (normalizedType === "mcp" || includesMcpToken(normalizedType)) return false;
  if (includesMcpToken(service.name) || includesMcpToken(service.endpoint)) return false;
  if (normalizedType && !TALK_NORMALIZED_TYPES.has(normalizedType)) return false;
  return true;
}

export function resolveAgentTalkTarget(
  services: readonly AgentTalkServiceLike[],
  signals: readonly ServiceHealthSignalRow[],
): AgentTalkTarget {
  const candidates = services.filter(isTalkServiceCandidate);
  if (candidates.length === 0) {
    return {
      status: "unavailable",
      reason: "no_talk_endpoint",
      serviceName: null,
    };
  }

  for (const service of candidates) {
    const health = resolveServiceHealth(
      service.id,
      service.name,
      service.endpoint,
      [...signals],
    );
    if (health.status === "live") {
      return {
        status: "live",
        serviceId: service.id,
        serviceName: service.name,
        endpoint: service.endpoint.trim(),
      };
    }
  }

  const first = candidates[0]!;
  const health = resolveServiceHealth(
    first.id,
    first.name,
    first.endpoint,
    [...signals],
  );
  const reason =
    health.status === "failing"
      ? "endpoint_failing"
      : health.status === "stale"
        ? "endpoint_stale"
        : "endpoint_not_live";

  return {
    status: "unavailable",
    reason,
    serviceName: first.name,
  };
}

export function agentTalkUnavailableMessage(reason: string): string {
  switch (reason) {
    case "endpoint_failing":
    case "endpoint_stale":
    case "endpoint_not_live":
    case "no_talk_endpoint":
      return "Sorry, the AI service is currently unavailable. Please try again later.";
    case "rate_limited":
      return "Too many messages. Please wait a moment and try again.";
    case "invalid_message":
      return "Enter a message to send.";
    default:
      return "Sorry, the AI service is currently unavailable. Please try again later.";
  }
}
