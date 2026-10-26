import { z } from "zod";
import { mapWithConcurrency } from "@/lib/async-pool";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { prisma } from "@/lib/db";
import {
  findAgentFuzzyNameCandidates,
  orderRowsByFuzzyCandidates,
} from "@/lib/agent-fuzzy-search.server";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { resolveAgentListSearchForApi } from "@/lib/agents-search-scope";
import { siteDevFeaturesEnabled } from "@/lib/site-dev-features";
import { walletMatchesAgent } from "@/lib/verify-ownership";
import { parseAgentFromUrl } from "@/lib/agent-url-parse";
import { normalizeVerifySearchQuery } from "@/lib/dashboard/verify-search-query";
import { getChainByChainId } from "@/lib/chains";
import { timeoutSignal } from "@/lib/timing/abort";
import type { VerifyAgentLookup, VerifyClaimChain } from "@/lib/dashboard/verify-lookup";

const ProductionVerifyAgentSchema = z.object({
  id: z.number().int(),
  agentId: z.number().int(),
  chainId: z.number().int(),
  name: z.string(),
  image: z.string().optional().default(""),
  isPremiumVerified: z.boolean().optional().default(false),
  canClaim: z.boolean().nullable().optional(),
  slug: z.string().optional(),
  profilePath: z.string().optional(),
  chain: z.object({
    name: z.string().optional(),
    shortName: z.string(),
    color: z.string(),
    icon: z.string(),
  }),
  owner: z.string().optional(),
  agentWallet: z.string().nullable().optional(),
});

export type VerifySearchHit = VerifyAgentLookup & {
  remoteOnly?: boolean;
};
const PRODUCTION_LOOKUP_ORIGIN =
  process.env.VERIFY_PRODUCTION_LOOKUP_ORIGIN?.trim() || "https://app.agentranking.io";
type AgentRow = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  image: string;
  isPremiumVerified: boolean;
  owner: string | null;
  chain: { name: string; shortName: string; color: string; icon: string };
  metadata?: { key: string; value: string }[];
};
async function resolveCanClaim(
  agent: AgentRow,
  wallet: string | null | undefined,
): Promise<boolean | null> {
  if (!wallet?.trim()) return null;
  const canClaim = walletMatchesAgent(wallet, {
    owner: agent.owner ?? "",
    metadata: agent.metadata,
  });
  return canClaim;
}
function mapAgentRow(agent: AgentRow, canClaim: boolean | null): VerifySearchHit {
  const chain = enrichChainDisplay(agent.chainId, agent.chain);
  return {
    id: agent.id,
    agentId: agent.agentId,
    chainId: agent.chainId,
    name: agent.name,
    image: agent.image,
    isPremiumVerified: agent.isPremiumVerified,
    canClaim,
    slug: toAgentUrlSlug(agent.name),
    profilePath: agentPublicPath(agent),
    chain: {
      name: chain.name,
      shortName: chain.shortName,
      color: chain.color,
      icon: chain.icon,
    },
    remoteOnly: false,
  };
}
const agentSelect = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  image: true,
  owner: true,
  isPremiumVerified: true,
  chain: true,
  metadata: { select: { key: true, value: true } },
} as const;
async function localAgentByChainAndId(
  chainId: number,
  agentId: number,
  wallet?: string | null,
): Promise<VerifySearchHit | null> {
  const agent = await prisma.agent.findUnique({
    where: { agentId_chainId: { agentId, chainId } },
    select: agentSelect,
  });
  if (!agent) return null;
  const canClaim = await resolveCanClaim(agent, wallet);
  return mapAgentRow(agent, canClaim);
}
async function localNameSearch(query: string, wallet?: string | null): Promise<VerifySearchHit[]> {
  const apiSearch = resolveAgentListSearchForApi(query);
  if (!apiSearch) return [];
  const expandedSearch = apiSearch.replaceAll("-", " ");
  const exactAgents = await prisma.agent.findMany({
    where: {
      OR: [
        { name: { contains: apiSearch, mode: "insensitive" } },
        ...(expandedSearch !== apiSearch
          ? [{ name: { contains: expandedSearch, mode: "insensitive" as const } }]
          : []),
        { description: { contains: apiSearch, mode: "insensitive" } },
        { owner: { contains: apiSearch, mode: "insensitive" } },
      ],
    },
    select: agentSelect,
    orderBy: [{ score: "desc" }, { id: "asc" }],
    take: 20,
  });

  let agents = exactAgents;
  if (exactAgents.length < 20) {
    const fuzzyCandidates = await findAgentFuzzyNameCandidates({
      query: apiSearch,
      limit: 64,
    });
    const exactIds = new Set(exactAgents.map((agent) => agent.id));
    const fuzzyIds = fuzzyCandidates
      .map((candidate) => candidate.id)
      .filter((id) => !exactIds.has(id));
    if (fuzzyIds.length > 0) {
      const fuzzyRows = await prisma.agent.findMany({
        where: { id: { in: fuzzyIds } },
        select: agentSelect,
      });
      agents = [
        ...exactAgents,
        ...orderRowsByFuzzyCandidates(fuzzyRows, fuzzyCandidates),
      ].slice(0, 20);
    }
  }

  return mapWithConcurrency(
    agents,
    6,
    async (agent) => mapAgentRow(agent, await resolveCanClaim(agent, wallet)),
  );
}
async function productionVerifyHit(
  chainId: number,
  id: string,
  wallet?: string | null,
): Promise<VerifySearchHit | null> {
  const params = new URLSearchParams({ chainId: String(chainId), id });
  if (wallet?.trim()) params.set("wallet", wallet.trim().toLowerCase());
  const res = await fetch(`${PRODUCTION_LOOKUP_ORIGIN}/api/verify/agent?${params}`, {
    next: { revalidate: 0 },
    signal: timeoutSignal(8_000),
  });
  if (!res.ok) return null;
  const data = await parseBoundedJsonBody(res, ProductionVerifyAgentSchema, 512 * 1024);
  const chain = enrichChainDisplay(data.chainId, data.chain);
  return {
    ...data,
    chain: {
      name: chain.name,
      shortName: chain.shortName,
      color: chain.color,
      icon: chain.icon,
    },
    remoteOnly: true,
  };
}
function enrichChainDisplay(
  chainId: number,
  chain: { shortName: string; color: string; icon: string },
): { shortName: string; color: string; icon: string; name: string } {
  const cfg = getChainByChainId(chainId);
  return {
    name: cfg?.name ?? chain.shortName,
    shortName: chain.shortName?.trim() || cfg?.shortName || "?",
    color: chain.color?.trim() || cfg?.color || "#888888",
    icon: chain.icon?.trim() || cfg?.icon || "",
  };
}
function toClaimChain(hit: VerifySearchHit): VerifyClaimChain {
  const chain = enrichChainDisplay(hit.chainId, hit.chain);
  return {
    chainId: hit.chainId,
    agentId: hit.agentId,
    shortName: chain.shortName,
    color: chain.color,
    icon: chain.icon,
  };
}
function enrichSearchHit(hit: VerifySearchHit): VerifySearchHit {
  const chain = enrichChainDisplay(hit.chainId, hit.chain);
  return {
    ...hit,
    chain: {
      name: chain.name,
      shortName: chain.shortName,
      color: chain.color,
      icon: chain.icon,
    },
  };
}
function groupVerifySearchHits(hits: VerifySearchHit[]): VerifySearchHit[] {
  const byIdentity = new Map<string, VerifySearchHit>();
  for (const rawHit of hits.map(enrichSearchHit)) {
    const key = `${rawHit.chainId}:${rawHit.agentId}`;
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, rawHit);
      continue;
    }
    // Local and remote search may return the same Agent. Preserve that exact
    // identity once; duplicate names with different IDs remain separate choices.
    byIdentity.set(key, {
      ...existing,
      ...rawHit,
      remoteOnly: Boolean(existing.remoteOnly && rawHit.remoteOnly),
      claimChains: [toClaimChain(existing)],
    });
  }
  return [...byIdentity.values()];
}
async function ensureChainRow(chainId: number): Promise<void> {
  const existing = await prisma.chain.findUnique({ where: { chainId } });
  if (existing) return;
  const cfg = getChainByChainId(chainId);
  if (!cfg) throw new Error(`Unknown chain ${chainId}`);
  await prisma.chain.create({
    data: {
      chainId: cfg.chainId,
      name: cfg.name,
      shortName: cfg.shortName,
      icon: cfg.icon,
      color: cfg.color,
      identityRegistry: cfg.identityRegistry,
      reputationRegistry: cfg.reputationRegistry,
      isActive: cfg.isActive,
    },
  });
}
type ProductionVerifyAgent = z.infer<typeof ProductionVerifyAgentSchema>;

async function fetchProductionAgent(
  chainId: number,
  id: string,
  wallet?: string | null,
): Promise<ProductionVerifyAgent | null> {
  const params = new URLSearchParams({ chainId: String(chainId), id });
  if (wallet?.trim()) params.set("wallet", wallet.trim().toLowerCase());
  const res = await fetch(`${PRODUCTION_LOOKUP_ORIGIN}/api/verify/agent?${params}`, {
    cache: "no-store",
    signal: timeoutSignal(8_000),
  });
  if (!res.ok) return null;
  return parseBoundedJsonBody(res, ProductionVerifyAgentSchema, 512 * 1024);
}
async function upsertAgentFromProduction(remote: ProductionVerifyAgent): Promise<AgentRow> {
  await ensureChainRow(remote.chainId);
  const owner = remote.owner?.trim() ?? "";
  const agent = await prisma.agent.upsert({
    where: {
      agentId_chainId: { agentId: remote.agentId, chainId: remote.chainId },
    },
    create: {
      agentId: remote.agentId,
      chainId: remote.chainId,
      name: remote.name,
      image: remote.image ?? "",
      owner,
      isPremiumVerified: remote.isPremiumVerified ?? false,
    },
    update: {
      name: remote.name,
      image: remote.image ?? "",
      ...(owner ? { owner } : {}),
    },
    select: agentSelect,
  });
  const agentWallet = remote.agentWallet?.trim();
  if (agentWallet) {
    const existing = await prisma.agentMetadata.findFirst({
      where: { agentId: agent.id, key: "agentWallet" },
    });
    if (existing) {
      await prisma.agentMetadata.update({
        where: { id: existing.id },
        data: { value: agentWallet },
      });
    } else {
      await prisma.agentMetadata.create({
        data: { agentId: agent.id, key: "agentWallet", value: agentWallet },
      });
    }
    agent.metadata = [{ key: "agentWallet", value: agentWallet }];
  }
  return agent;
}
export async function importRemoteVerifyAgent(
  chainId: number,
  agentId: number,
  wallet?: string | null,
  claimChains?: VerifyClaimChain[],
): Promise<VerifySearchHit> {
  if (!siteDevFeaturesEnabled()) {
    throw new Error("Remote import is only available in local development.");
  }
  const deployments =
    claimChains && claimChains.length > 0
      ? claimChains
      : [{ chainId, agentId, shortName: "", color: "", icon: "" }];
  let primary: VerifySearchHit | null = null;
  for (const dep of deployments) {
    const remote = await fetchProductionAgent(
      dep.chainId,
      String(dep.agentId),
      wallet,
    );
    if (!remote) continue;
    const row = await upsertAgentFromProduction(remote);
    const canClaim = await resolveCanClaim(row, wallet);
    const hit = mapAgentRow(row, canClaim);
    if (dep.chainId === chainId && dep.agentId === agentId) {
      primary = hit;
    } else if (!primary) {
      primary = hit;
    }
  }
  if (!primary) {
    throw new Error("Could not import this agent from production.");
  }
  await invalidateAllPublicStatistics();
  if (claimChains && claimChains.length > 1) {
    primary = {
      ...primary,
      claimChains: claimChains.map((c) => {
        const chain = enrichChainDisplay(c.chainId, c);
        return {
          chainId: c.chainId,
          agentId: c.agentId,
          shortName: chain.shortName,
          color: chain.color,
          icon: chain.icon,
        };
      }),
    };
  }
  return primary;
}
export async function searchVerifyAgents(
  query: string,
  wallet?: string | null,
): Promise<{ agents: VerifySearchHit[]; usedProductionFallback: boolean }> {
  const trimmed = normalizeVerifySearchQuery(query);
  if (!trimmed) return { agents: [], usedProductionFallback: false };
  const parsed = parseAgentFromUrl(trimmed);
  if (parsed) {
    const local = await localAgentByChainAndId(parsed.chainId, parsed.agentId, wallet);
    if (local && local.slug === parsed.slug) {
      return { agents: groupVerifySearchHits([local]), usedProductionFallback: false };
    }
    if (siteDevFeaturesEnabled()) {
      const remote = await productionVerifyHit(parsed.chainId, String(parsed.agentId), wallet);
      if (remote && toAgentUrlSlug(remote.name) === parsed.slug) {
        return { agents: groupVerifySearchHits([remote]), usedProductionFallback: true };
      }
    }
    return { agents: [], usedProductionFallback: false };
  }
  const nameHits = await localNameSearch(trimmed, wallet);
  if (nameHits.length > 0) {
    return { agents: groupVerifySearchHits(nameHits), usedProductionFallback: false };
  }
  return { agents: [], usedProductionFallback: false };
}
