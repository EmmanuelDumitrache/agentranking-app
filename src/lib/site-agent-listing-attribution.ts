import type { AgentRegistrationParams } from "@/lib/build-agent-uri";
/** Canonical site used for subtle listing attribution (not in agent `name`). */
export const AGENT_RANKING_LISTING_URL = "https://agentranking.io";
/** DB / API metadata key for directory discovery attribution. */
export const AGENT_RANKING_LISTING_METADATA_KEY = "discoveryUrl";
const LISTING_HOST_MARKER = "agentranking.io";
const DESCRIPTION_SUFFIX = `\n\nListed on ${LISTING_HOST_MARKER}.`;
export type SiteLaunchRegistrationParams = AgentRegistrationParams & {
  external_url: string;
};
export function mergeDescriptionWithListingAttribution(description: string): string {
  const trimmed = description.trimEnd();
  if (trimmed.toLowerCase().includes(LISTING_HOST_MARKER)) {
    return description;
  }
  if (!trimmed) {
    return `Listed on ${LISTING_HOST_MARKER}.`;
  }
  return `${trimmed}${DESCRIPTION_SUFFIX}`;
}
/** Params for `buildRegistrationJson` / `buildAgentDataUri` after site listing attribution. */
export function applyToRegistrationParams(params: AgentRegistrationParams): SiteLaunchRegistrationParams {
  return {
    ...params,
    description: mergeDescriptionWithListingAttribution(params.description),
    external_url: AGENT_RANKING_LISTING_URL,
  };
}
/** Keys refreshed on agent update + full row set for create (listing + wallet win over client). */
export function mergeRegisterMetadataForDb(
  owner: string,
  clientEntries: Array<{ key: string; value: string }> | undefined
): { key: string; value: string }[] {
  const map = new Map<string, string>();
  for (const e of clientEntries ?? []) {
    const k = e.key.trim();
    if (!k || k === "agentWallet" || k === AGENT_RANKING_LISTING_METADATA_KEY) continue;
    map.set(k.slice(0, 80), e.value);
  }
  map.set(AGENT_RANKING_LISTING_METADATA_KEY, AGENT_RANKING_LISTING_URL);
  map.set("agentWallet", owner);
  return [...map.entries()].map(([key, value]) => ({ key, value }));
}