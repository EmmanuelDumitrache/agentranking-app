import {
  AGENTRANKING_NATIVE_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  SOLANA_CHAIN_ID,
} from "@/lib/chain-constants";
import { getChainByChainId } from "@/lib/chains";

/** Compact local chain marks for list badges and Agent World labels. */
const CHAIN_ICON_OVERRIDES: Record<number, string> = {
  1: "/chains/ethereum.svg",
  10: "/chains/optimism.svg",
  56: "/chains/bsc.svg",
  100: "/chains/gnosis.svg",
  137: "/chains/polygon.svg",
  143: "/chains/monad.svg",
  196: "/chains/xlayer.svg",
  360: "/chains/shape.png",
  1088: "/chains/metis.svg",
  1868: "/chains/soneium.svg",
  2741: "/chains/abstract.svg",
  4326: "/chains/megaeth.svg",
  5000: "/chains/mantle.svg",
  8453: "/chains/base.svg",
  84532: "/chains/base.svg",
  9745: "/chains/plasma.svg",
  42161: "/chains/arbitrum.svg",
  42220: "/chains/celo.svg",
  43114: "/chains/avalanche.svg",
  45056: "/chains/billions.svg",
  534352: "/chains/scroll.svg",
  59144: "/chains/linea.svg",
  167000: "/chains/taiko.svg",
  2046399126: "/chains/skale.svg",
  1187947933: "/chains/skale.svg",
  [SOLANA_CHAIN_ID]: "/chains/solana.svg",
  [ARC_TESTNET_CHAIN_ID]: "/chains/arc.svg",
  [AGENTRANKING_NATIVE_CHAIN_ID]: "/ar-mark.png",
};

/**
 * Resolve chain logo URL for list badges — prefers local overrides, then static catalog, then DB.
 */
export function resolveChainIconUrl(chainId: number, dbIcon?: string | null): string {
  const override = CHAIN_ICON_OVERRIDES[chainId];
  if (override) return override;
  const fromCatalog = getChainByChainId(chainId)?.icon;
  if (fromCatalog?.trim()) return fromCatalog;
  const trimmed = dbIcon?.trim();
  return trimmed ?? "";
}
