import { HATCHER_CHAIN_ID, HATCHER_LISTING_REGISTRY_SOURCE } from "@/lib/hatcher/config";
import { METAPLEX_LISTING_REGISTRY_SOURCE } from "@/lib/metaplex/config";
import type { NewAgentScannerAgent } from "@/lib/new-agent-scanner/types";
function titleCaseSlug(slug: string): string {
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
/** Partner / listing source column for scanner rows. */
export function newAgentSourceLabel(agent: NewAgentScannerAgent): string {
  const src = agent.listingRegistrySource?.trim().toLowerCase() ?? "";
  if (src === METAPLEX_LISTING_REGISTRY_SOURCE || agent.metaplexVerified) return "Metaplex";
  if (src === HATCHER_LISTING_REGISTRY_SOURCE || agent.chainId === HATCHER_CHAIN_ID) return "Hatcher";
  if (agent.sapVerified || agent.sapTwinMatch) return "SAP";
  if (agent.archetype === "telegram" || agent.chainId === 9999) return "Telegram";
  if (src === "covenant") return "Covenant";
  if (src === "oobe") return "OOBE";
  if (src === "xona") return "Xona";
  if (src === "said") return "SAID";
  if (src) return titleCaseSlug(src);
  return "ERC-8004";
}