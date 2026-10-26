import "server-only";
import { Counter, Histogram } from "prom-client";
import type { AgentRouteSlugMismatchReason } from "@/lib/agent-public-route-core";

export type AgentRouteNotFoundReason =
  | "invalid_agent_id"
  | "invalid_chain_id"
  | "malformed_slug"
  | "missing_agent"
  | "not_public"
  | "blocked"
  | AgentRouteSlugMismatchReason;

type AgentRouteMetrics = {
  notFound: Counter<"reason">;
  identityLookupDuration: Histogram;
  slugMismatch: Counter<"reason">;
  success: Counter;
};

const globalForAgentRouteMetrics = globalThis as typeof globalThis & {
  __agentRankingAgentRouteMetrics?: AgentRouteMetrics;
};

function metrics(): AgentRouteMetrics {
  return (globalForAgentRouteMetrics.__agentRankingAgentRouteMetrics ??= {
    notFound: new Counter({
      name: "agent_route_not_found_total",
      help: "Agent public-route resolution failures by bounded reason.",
      labelNames: ["reason"],
    }),
    identityLookupDuration: new Histogram({
      name: "agent_route_identity_lookup_duration_seconds",
      help: "Direct PostgreSQL Agent route-identity lookup duration.",
      buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    }),
    slugMismatch: new Counter({
      name: "agent_route_slug_mismatch_total",
      help: "Rejected Agent route slug mismatches by bounded reason.",
      labelNames: ["reason"],
    }),
    success: new Counter({
      name: "agent_route_success_total",
      help: "Successfully resolved canonical Agent public routes.",
    }),
  });
}

export function startAgentRouteIdentityLookupTimer(): () => void {
  return metrics().identityLookupDuration.startTimer();
}

export function recordAgentRouteNotFound(reason: AgentRouteNotFoundReason): void {
  metrics().notFound.inc({ reason });
}

export function recordAgentRouteSlugMismatch(reason: AgentRouteSlugMismatchReason): void {
  metrics().slugMismatch.inc({ reason });
}

export function recordAgentRouteSuccess(): void {
  metrics().success.inc();
}
