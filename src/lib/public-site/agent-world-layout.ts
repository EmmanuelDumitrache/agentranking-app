import type {
  AgentWorldAgentPreview,
  AgentWorldChainCluster,
} from "@/lib/public-site/world-types";
import { AGENTRANKING_NATIVE_CHAIN_ID } from "@/lib/chain-constants";

export type AgentWorldCorpusTierKey = "verified" | "listed" | "unranked" | "dead";

export type AgentWorldFilterKey =
  | "verified"
  | "kyc"
  | "business"
  | "registered"
  | "live"
  | "x402"
  | "mcp"
  | "dead";

export type AgentWorldCorpusTier = {
  readonly key: AgentWorldCorpusTierKey;
  readonly label: string;
  readonly shortLabel: string;
  readonly color: string;
  readonly glow?: boolean;
  readonly count: number;
  readonly hint: string;
};

export type AgentWorldPoint = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly tier: AgentWorldCorpusTierKey;
  readonly chainId: number;
  readonly agentIndex: number;
};

export type AgentWorldPlacedPreview = AgentWorldAgentPreview & {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

const GOLDEN_ANGLE = 2.399963229728653;

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCorpusTiers(input: {
  readonly indexedAgents: number;
  readonly listedAgents: number;
  readonly verifiedAgents: number;
  readonly deadOrSpamAgents: number;
  readonly activeUnrankedAgents: number;
}): AgentWorldCorpusTier[] {
  const listedUnverified = Math.max(0, input.listedAgents - input.verifiedAgents);
  const unranked = Math.max(0, input.activeUnrankedAgents);
  const dead = Math.max(0, input.deadOrSpamAgents);

  return [
    {
      key: "verified",
      label: "Verified",
      shortLabel: "Verified",
      color: "#22c55e",
      glow: true,
      count: input.verifiedAgents,
      hint: "Passes AgentRanking verification and is eligible for ranked discovery.",
    },
    {
      key: "listed",
      label: "Listed",
      shortLabel: "Listed",
      color: "#eab308",
      count: listedUnverified,
      hint: "Active listed agents that are indexed but not verified yet.",
    },
    {
      key: "unranked",
      label: "Unranked",
      shortLabel: "Unranked",
      color: "#ca8a04",
      count: unranked,
      hint: "Indexed warehouse rows that are active but hidden from the ranked list.",
    },
    {
      key: "dead",
      label: "Dead / spam",
      shortLabel: "Dead",
      color: "#ef4444",
      count: dead,
      hint: "Inactive, empty, blocked, or junk registrations in the warehouse.",
    },
  ];
}

export function computeChainCenters(
  chains: readonly AgentWorldChainCluster[],
): Map<number, [number, number, number]> {
  const sorted = [...chains]
    .filter((chain) => chain.chainId !== AGENTRANKING_NATIVE_CHAIN_ID)
    .sort((a, b) => b.listedCount - a.listedCount || b.indexedCount - a.indexedCount);
  const positions = new Map<number, [number, number, number]>();
  if (sorted.length === 0) return positions;

  const maxCount = Math.max(...sorted.map((chain) => chain.listedCount), 1);

  for (let index = 0; index < sorted.length; index += 1) {
    const chain = sorted[index]!;
    const sizing = Math.max(chain.listedCount, chain.indexedCount, 1);
    const radius = 14 + (1 - sizing / maxCount) * 38;
    const angle = index * GOLDEN_ANGLE;
    const ySpread = ((index % 5) - 2) * 4.2;
    positions.set(chain.chainId, [Math.cos(angle) * radius, ySpread, Math.sin(angle) * radius]);
  }

  return positions;
}

export function arClusterCenter(): [number, number, number] {
  return [0, 0, 0];
}

function pickTier(
  random: () => number,
  weights: Readonly<Record<AgentWorldCorpusTierKey, number>>,
): AgentWorldCorpusTierKey {
  const total =
    weights.verified + weights.listed + weights.unranked + weights.dead;
  if (total <= 0) return "listed";
  let roll = random() * total;
  for (const key of ["verified", "listed", "unranked", "dead"] as const) {
    roll -= weights[key];
    if (roll <= 0) return key;
  }
  return "dead";
}

function visualPointBudget(chain: AgentWorldChainCluster): number {
  return Math.max(1, Math.min(chain.listedCount, 80_000));
}

export function clusterRadius(chain: AgentWorldChainCluster): number {
  return 0.9 + chain.weight * 2.1;
}

export function buildAgentWorldPoints(input: {
  readonly chains: readonly AgentWorldChainCluster[];
  readonly arCluster: AgentWorldChainCluster;
  readonly tiers: readonly AgentWorldCorpusTier[];
}): AgentWorldPoint[] {
  const centers = computeChainCenters(input.chains);
  const tierWeights = Object.fromEntries(input.tiers.map((tier) => [tier.key, tier.count])) as Record<
    AgentWorldCorpusTierKey,
    number
  >;
  const points: AgentWorldPoint[] = [];

  const appendClusterPoints = (chain: AgentWorldChainCluster, center: [number, number, number]) => {
    const count = visualPointBudget(chain);
    const radius = clusterRadius(chain);
    const random = mulberry32(chain.chainId * 2654435761);

    for (let index = 0; index < count; index += 1) {
      const u = random();
      const v = random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const shell = 0.12 + random() * random() * 0.72;
      const jitter = radius * shell;
      const tier = pickTier(random, tierWeights);

      points.push({
        x: center[0] + jitter * Math.sin(phi) * Math.cos(theta),
        y: center[1] + jitter * Math.sin(phi) * Math.sin(theta) * 0.72,
        z: center[2] + jitter * Math.cos(phi),
        tier,
        chainId: chain.chainId,
        agentIndex: index,
      });
    }
  };

  appendClusterPoints(input.arCluster, arClusterCenter());

  for (const chain of input.chains) {
    if (chain.chainId === AGENTRANKING_NATIVE_CHAIN_ID) continue;
    const center = centers.get(chain.chainId) ?? [0, 0, 0];
    appendClusterPoints(chain, center);
  }

  return points;
}

export function placeAgentWorldPreviews(input: {
  readonly chains: readonly AgentWorldChainCluster[];
  readonly arCluster: AgentWorldChainCluster;
  readonly previews: readonly AgentWorldAgentPreview[];
}): AgentWorldPlacedPreview[] {
  const centers = computeChainCenters(input.chains);
  const chainById = new Map(input.chains.map((chain) => [chain.chainId, chain]));
  chainById.set(input.arCluster.chainId, input.arCluster);

  const grouped = new Map<number, AgentWorldAgentPreview[]>();
  for (const preview of input.previews) {
    const list = grouped.get(preview.chainId) ?? [];
    list.push(preview);
    grouped.set(preview.chainId, list);
  }

  const placed: AgentWorldPlacedPreview[] = [];
  for (const [chainId, agents] of grouped) {
    const chain = chainById.get(chainId);
    if (!chain) continue;
    const center =
      chainId === AGENTRANKING_NATIVE_CHAIN_ID
        ? arClusterCenter()
        : (centers.get(chainId) ?? arClusterCenter());
    const radius = clusterRadius(chain);
    const random = mulberry32(chainId * 2654435761 + 17);

    for (const agent of agents) {
      const u = random();
      const v = random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const shell = 0.12 + random() * random() * 0.72;
      const jitter = radius * shell;
      placed.push({
        ...agent,
        x: center[0] + jitter * Math.sin(phi) * Math.cos(theta),
        y: center[1] + jitter * Math.sin(phi) * Math.sin(theta) * 0.72,
        z: center[2] + jitter * Math.cos(phi),
      });
    }
  }

  return placed;
}

export function placeClusterAgentsEvenly(
  chain: AgentWorldChainCluster,
  center: [number, number, number],
  agents: readonly AgentWorldAgentPreview[],
): AgentWorldPlacedPreview[] {
  const radius = clusterRadius(chain);
  const count = agents.length;
  if (count === 0) return [];

  return agents.map((agent, index) => {
    const golden = index * GOLDEN_ANGLE;
    const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const shell = 0.16 + (index % 6) * 0.08;
    const jitter = radius * shell;
    return {
      ...agent,
      x: center[0] + ringRadius * Math.cos(golden) * jitter,
      y: center[1] + y * jitter * 0.72,
      z: center[2] + ringRadius * Math.sin(golden) * jitter,
    };
  });
}

export function buildWorldPreviewPlacements(input: {
  readonly chains: readonly AgentWorldChainCluster[];
  readonly arCluster: AgentWorldChainCluster;
  readonly previews: readonly AgentWorldAgentPreview[];
  readonly expandedClusterId?: number | null;
  readonly expandedClusterAgents?: readonly AgentWorldAgentPreview[] | null;
}): AgentWorldPlacedPreview[] {
  const base = placeAgentWorldPreviews({
    chains: input.chains,
    arCluster: input.arCluster,
    previews: input.previews,
  });

  if (input.expandedClusterId == null || !input.expandedClusterAgents?.length) {
    return base;
  }

  const chainById = new Map(input.chains.map((chain) => [chain.chainId, chain]));
  chainById.set(input.arCluster.chainId, input.arCluster);
  const chain = chainById.get(input.expandedClusterId);
  if (!chain) return base;

  const centers = computeChainCenters(input.chains);
  const center =
    input.expandedClusterId === AGENTRANKING_NATIVE_CHAIN_ID
      ? arClusterCenter()
      : (centers.get(input.expandedClusterId) ?? arClusterCenter());
  const expanded = placeClusterAgentsEvenly(chain, center, input.expandedClusterAgents);

  return [...base.filter((preview) => preview.chainId !== input.expandedClusterId), ...expanded];
}

export function tierColorMap(tiers: readonly AgentWorldCorpusTier[]): Record<AgentWorldCorpusTierKey, string> {
  return Object.fromEntries(tiers.map((tier) => [tier.key, tier.color])) as Record<
    AgentWorldCorpusTierKey,
    string
  >;
}

export function corpusTiersForWorldFilters(
  filters: ReadonlySet<AgentWorldFilterKey>,
): ReadonlySet<AgentWorldCorpusTierKey> | null {
  if (filters.size === 0) return null;
  const tiers = new Set<AgentWorldCorpusTierKey>();
  for (const filter of filters) {
    switch (filter) {
      case "verified":
      case "kyc":
      case "business":
        tiers.add("verified");
        break;
      case "live":
      case "x402":
      case "mcp":
        tiers.add("verified");
        tiers.add("listed");
        break;
      case "registered":
        tiers.add("verified");
        tiers.add("listed");
        tiers.add("unranked");
        break;
      case "dead":
        tiers.add("dead");
        break;
      default: {
        const exhaustive: never = filter;
        throw new Error(`Unhandled world filter: ${exhaustive}`);
      }
    }
  }
  return tiers;
}
