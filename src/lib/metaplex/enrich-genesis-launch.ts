import {
  fetchGenesisBondingFillPct,
  isBondingCurveMechanic,
} from "@/lib/metaplex/genesis-bonding-onchain";
import {
  fetchGenesisLaunchesByTokenMint,
  genesisLaunchToPartialEnrichment,
  pickBestGenesisLaunch,
} from "@/lib/metaplex/genesis-api-client";
import { normalizeBondingProgressPct } from "@/lib/metaplex/genesis-rules";
import type { MetaplexGenesisEnrichment } from "@/lib/metaplex/types";
export type EnrichGenesisLaunchOptions = {
  tokenMint: string;
  /** Skip on-chain RPC (API metadata only). */
  skipOnChain?: boolean;
  network?: "solana-mainnet" | "solana-devnet";
};
export type EnrichGenesisLaunchResult = {
  /** When false, callers must not overwrite existing genesis columns (transient API failure). */
  persist: boolean;
  enrichment: MetaplexGenesisEnrichment;
};
function emptyEnrichment(technicalNote: string | null = null): MetaplexGenesisEnrichment {
  return {
    launchAddress: null,
    launchType: null,
    launchStatus: null,
    tradeUrl: null,
    bondingProgressPct: null,
    bondingProgressSource: null,
    bondingProgressUpdatedAt: null,
    technicalNote,
  };
}
export async function enrichGenesisLaunch(
  options: EnrichGenesisLaunchOptions,
): Promise<EnrichGenesisLaunchResult> {
  const mint = options.tokenMint.trim();
  if (!mint) {
    return { persist: true, enrichment: emptyEnrichment() };
  }
  const lookup = await fetchGenesisLaunchesByTokenMint(mint, options.network);
  if (lookup.status === "error") {
    return {
      persist: false,
      enrichment: emptyEnrichment(
        `Genesis API lookup failed: ${lookup.error}`,
      ),
    };
  }
  const launches = lookup.status === "ok" ? (lookup.data.launches ?? []) : [];
  const launch = pickBestGenesisLaunch(launches);
  if (!launch) {
    return {
      persist: true,
      enrichment: emptyEnrichment(
        "No Genesis launch found for token mint via GET /v1/tokens/{mint}.",
      ),
    };
  }
  const partial = genesisLaunchToPartialEnrichment(launch);
  const launchType = partial.launchType;
  const launchStatus = partial.launchStatus;
  const genesisAddress = partial.launchAddress;
  let bondingProgressPct: number | null = null;
  let bondingProgressSource: string | null = null;
  let technicalNote: string | null = null;
  const wantsOnChain =
    !options.skipOnChain &&
    Boolean(genesisAddress) &&
    isBondingCurveMechanic(launchType) &&
    !launchStatus?.toLowerCase().includes("graduated");
  if (wantsOnChain && genesisAddress) {
    const onChain = await fetchGenesisBondingFillPct(genesisAddress);
    if (onChain.ok && onChain.fillPct != null) {
      bondingProgressPct = normalizeBondingProgressPct(
        onChain.fillPct,
        launchStatus,
        "metaplex_genesis_onchain",
      );
      bondingProgressSource = bondingProgressPct != null ? "metaplex_genesis_onchain" : null;
    } else {
      technicalNote = onChain.technicalNote ?? onChain.error ?? null;
    }
  }
  return {
    persist: true,
    enrichment: {
      launchAddress: genesisAddress,
      launchType,
      launchStatus,
      tradeUrl: partial.tradeUrl,
      bondingProgressPct,
      bondingProgressSource,
      bondingProgressUpdatedAt: new Date().toISOString(),
      technicalNote,
    },
  };
}
/** Map enrichment to Prisma agent update fields + raw genesis blob. */
export function genesisEnrichmentToDbFields(enrichment: MetaplexGenesisEnrichment): {
  metaplexLaunchAddress: string | null;
  metaplexLaunchType: string | null;
  metaplexLaunchStatus: string | null;
  metaplexTradeUrl: string | null;
  metaplexBondingProgressPct: number | null;
  metaplexBondingProgressSource: string | null;
  metaplexBondingProgressUpdatedAt: Date | null;
  genesisRaw: MetaplexGenesisEnrichment;
} {
  return {
    metaplexLaunchAddress: enrichment.launchAddress,
    metaplexLaunchType: enrichment.launchType,
    metaplexLaunchStatus: enrichment.launchStatus,
    metaplexTradeUrl: enrichment.tradeUrl,
    metaplexBondingProgressPct: enrichment.bondingProgressPct,
    metaplexBondingProgressSource: enrichment.bondingProgressSource,
    metaplexBondingProgressUpdatedAt: enrichment.bondingProgressUpdatedAt
      ? new Date(enrichment.bondingProgressUpdatedAt)
      : null,
    genesisRaw: enrichment,
  };
}