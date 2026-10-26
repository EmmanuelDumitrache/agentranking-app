import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { needsMetaplexGenesisHydration } from "@/lib/metaplex/genesis-hydration-state";
import { fetchMetaplexDexPairs } from "@/lib/metaplex/dex-token-client";
import {
  enrichGenesisLaunch,
  genesisEnrichmentToDbFields,
} from "@/lib/metaplex/enrich-genesis-launch";
export type MetaplexGenesisAgentFields = {
  metaplexLaunchAddress: string | null;
  metaplexLaunchType: string | null;
  metaplexLaunchStatus: string | null;
  metaplexTradeUrl: string | null;
  metaplexBondingProgressPct: number | null;
  metaplexBondingProgressSource: string | null;
  metaplexBondingProgressUpdatedAt: Date | null;
  metaplexHasDexPair: boolean | null;
  metaplexRawData: unknown;
};
async function resolveMetaplexHasDexPair(tokenMint: string): Promise<boolean | undefined> {
  try {
    const pairs = await fetchMetaplexDexPairs(tokenMint);
    return pairs.length > 0;
  } catch {
    return undefined;
  }
}
export type PersistGenesisEnrichmentResult = {
  updated: boolean;
  persist: boolean;
  fields: MetaplexGenesisAgentFields | null;
};
export async function persistGenesisEnrichmentForAgent(
  agentDbId: number,
  tokenMint: string,
  existingRaw: unknown,
): Promise<PersistGenesisEnrichmentResult> {
  const [{ persist, enrichment }, hasDexPair] = await Promise.all([
    enrichGenesisLaunch({ tokenMint }),
    resolveMetaplexHasDexPair(tokenMint),
  ]);
  const dexUpdate =
    hasDexPair !== undefined ? { metaplexHasDexPair: hasDexPair } : {};
  if (!persist) {
    if (hasDexPair !== undefined) {
      await prisma.agent.update({
        where: { id: agentDbId },
        data: dexUpdate,
      });
    }
    return { updated: hasDexPair !== undefined, persist: false, fields: null };
  }
  const mapped = genesisEnrichmentToDbFields(enrichment);
  const prior =
    existingRaw && typeof existingRaw === "object"
      ? (existingRaw as Record<string, unknown>)
      : {};
  const metaplexRawData = {
    ...prior,
    genesis: mapped.genesisRaw,
  };
  const data: Prisma.AgentUpdateInput = {
    metaplexLaunchAddress: mapped.metaplexLaunchAddress,
    metaplexLaunchType: mapped.metaplexLaunchType,
    metaplexLaunchStatus: mapped.metaplexLaunchStatus,
    metaplexTradeUrl: mapped.metaplexTradeUrl,
    metaplexBondingProgressPct: mapped.metaplexBondingProgressPct,
    metaplexBondingProgressSource: mapped.metaplexBondingProgressSource,
    metaplexBondingProgressUpdatedAt: mapped.metaplexBondingProgressUpdatedAt,
    metaplexRawData,
    ...dexUpdate,
  };
  await prisma.agent.update({
    where: { id: agentDbId },
    data,
  });
  return {
    updated: true,
    persist: true,
    fields: {
      metaplexLaunchAddress: mapped.metaplexLaunchAddress,
      metaplexLaunchType: mapped.metaplexLaunchType,
      metaplexLaunchStatus: mapped.metaplexLaunchStatus,
      metaplexTradeUrl: mapped.metaplexTradeUrl,
      metaplexBondingProgressPct: mapped.metaplexBondingProgressPct,
      metaplexBondingProgressSource: mapped.metaplexBondingProgressSource,
      metaplexBondingProgressUpdatedAt: mapped.metaplexBondingProgressUpdatedAt,
      metaplexHasDexPair: hasDexPair ?? null,
      metaplexRawData,
    },
  };
}
export async function hydrateMetaplexGenesisIfMissing(
  agent: {
    id: number;
    metaplexAgentTokenMint?: string | null;
    metaplexTradeUrl?: string | null;
    metaplexLaunchAddress?: string | null;
    metaplexRawData?: unknown;
    metaplexHasDexPair?: boolean | null;
  },
): Promise<MetaplexGenesisAgentFields | null> {
  if (!needsMetaplexGenesisHydration(agent)) return null;
  const mint = agent.metaplexAgentTokenMint!.trim();
  const result = await persistGenesisEnrichmentForAgent(agent.id, mint, agent.metaplexRawData);
  return result.fields;
}