import { agentPublicPath } from "@/lib/agent-public-url";
import type { AgentWorldAgentPreview, AgentWorldChainCluster } from "@/lib/public-site/world-types";

const WORLD_DOT_ROLES = [
  "Scout",
  "Oracle",
  "Router",
  "Keeper",
  "Indexer",
  "Relay",
  "Guard",
  "Broker",
  "Watcher",
  "Curator",
  "Pilot",
  "Vault",
  "Signal",
  "Bridge",
  "Pulse",
  "Forge",
  "Beacon",
  "Harbor",
  "Quill",
  "Lens",
  "Atlas",
  "Nova",
  "Cipher",
  "Drift",
  "Prism",
  "Anchor",
  "Spark",
  "Glyph",
  "Summit",
  "Vector",
] as const;

const LISTED_AT_ORIGIN_MS = Date.UTC(2026, 0, 1);

export function synthesizeWorldDotPreview(
  chain: Pick<AgentWorldChainCluster, "chainId" | "shortName" | "name">,
  index: number,
): AgentWorldAgentPreview {
  const role = WORLD_DOT_ROLES[index % WORLD_DOT_ROLES.length] ?? "Scout";
  const batch = Math.floor(index / WORLD_DOT_ROLES.length) + 1;
  const agentId = index + 1;
  const name = batch > 1 ? `${chain.shortName} ${role} ${batch}` : `${chain.shortName} ${role}`;
  const bucket = index % 5;
  const verified = bucket === 0;
  const live = bucket !== 3 && bucket !== 4;
  let scoreBase = 24;
  if (verified) scoreBase = 78;
  else if (live) scoreBase = 48;
  const score = Math.max(18, Math.min(96, scoreBase + ((index * 7) % 19) - 6));

  return {
    chainId: chain.chainId,
    agentId,
    name,
    image: "",
    description: `${role} on ${chain.name}.`,
    href: agentPublicPath({ chainId: chain.chainId, agentId, name }),
    score,
    verified,
    live,
    registered: bucket !== 4,
    x402: index % 12 === 0,
    listedAt: new Date(LISTED_AT_ORIGIN_MS + index * 3_600_000).toISOString(),
    chainShortName: chain.shortName,
    socials: {
      twitter: index % 5 === 0 ? "https://x.com/agentranking" : null,
      telegram: index % 17 === 0 ? "https://t.me/agentranking" : null,
      website: index % 8 === 0 ? "https://agentranking.io" : null,
    },
  };
}

export function previewForWorldDot(input: {
  readonly chain: AgentWorldChainCluster;
  readonly index: number;
  readonly chainPreviews: readonly AgentWorldAgentPreview[];
}): AgentWorldAgentPreview {
  const real = input.chainPreviews[input.index];
  if (real) return real;
  return synthesizeWorldDotPreview(input.chain, input.index);
}
