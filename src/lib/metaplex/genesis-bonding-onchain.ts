/**
 * On-chain Metaplex Genesis bonding curve fill % via official SDK.
 * Requires BondingCurveBucketV2 account for the genesis launch address.
 */
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import {
  fetchBondingCurveBucketV2FromSeeds,
  genesis,
  getFillPercentage,
} from "@metaplex-foundation/genesis";
import { resolveMetaplexRpcUrl } from "@/lib/metaplex/rpc-config";
export type OnChainBondingFillResult = {
  ok: boolean;
  fillPct: number | null;
  error?: string;
  technicalNote?: string;
};
export async function fetchGenesisBondingFillPct(
  genesisAddress: string,
): Promise<OnChainBondingFillResult> {
  const address = genesisAddress.trim();
  if (!address) {
    return { ok: false, fillPct: null, error: "missing_genesis_address" };
  }
  try {
    const umi = createUmi(resolveMetaplexRpcUrl()).use(genesis());
    const bucket = await fetchBondingCurveBucketV2FromSeeds(umi, {
      genesisAccount: publicKey(address),
      bucketIndex: 0,
    });
    const fillPct = getFillPercentage(bucket);
    if (fillPct == null || !Number.isFinite(fillPct)) {
      return {
        ok: false,
        fillPct: null,
        technicalNote:
          "BondingCurveBucketV2 fetched but getFillPercentage returned no value.",
      };
    }
    return { ok: true, fillPct: Math.max(0, Math.min(100, fillPct)) };
  } catch (err) {
    const message = Error.isError(err) ? err.message : String(err);
    return {
      ok: false,
      fillPct: null,
      error: message,
      technicalNote:
        "Fetch BondingCurveBucketV2 via genesis SDK using genesisAddress; " +
        "call getFillPercentage(bucket) for fill %.",
    };
  }
}
export function isBondingCurveMechanic(mechanicOrType: string | null | undefined): boolean {
  const s = mechanicOrType?.toLowerCase() ?? "";
  return s.includes("bonding") || s.includes("curve");
}