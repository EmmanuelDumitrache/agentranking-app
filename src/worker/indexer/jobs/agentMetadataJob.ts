import type { AgentMetadataPayload } from "../queue/contracts.js";
import { hydrateEvmRegistration } from "../sync/agents.js";
export async function runAgentMetadataJob(
  payload: AgentMetadataPayload,
  signal?: AbortSignal,
): Promise<{ status: "updated" | "unchanged" | "permanent_invalid" | "deferred" }> {
  return { status: await hydrateEvmRegistration(payload.chainId, payload.agentId, payload.uri, signal) };
}
