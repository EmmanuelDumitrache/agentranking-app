import type { SolanaMetadataPayload } from "../queue/contracts.js";
import { hydrateSolanaRegistration } from "../sync/solana-8004/materialize-agent.js";
export async function runSolanaMetadataJob(
  payload: SolanaMetadataPayload,
  signal?: AbortSignal,
): Promise<{ status: "updated" | "unchanged" | "permanent_invalid" | "deferred" }> {
  return { status: await hydrateSolanaRegistration(payload.asset, payload.uri, signal) };
}