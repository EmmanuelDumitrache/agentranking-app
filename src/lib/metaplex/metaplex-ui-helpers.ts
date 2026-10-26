import type { ProfileDeployment } from "@/lib/agent-profile-deployments";
import { isDeploymentIndexed } from "@/lib/profile-deployment-status";
import type { MetaplexDexPair } from "@/lib/metaplex/dex-token-client";

import type { MetaplexDetailPayload } from "@/lib/metaplex/types";

import { computeMetaplexTradeable } from "@/lib/metaplex/metaplex-tradeable";
export function hasIndexedEvmDeployment(
  deployments: readonly ProfileDeployment[] | undefined,
): boolean {
  if (!deployments?.length) return false;
  return deployments.some((d) => d.kind === "evm" && isDeploymentIndexed(d));
}
export function shouldShowErc8004Protocol(input: {
  profileDeployments?: readonly ProfileDeployment[];
  listingRegistrySource?: string | null;
  metaplexAssetAddress?: string | null;
  metaplexVerified?: boolean | null;
}): boolean {
  return hasIndexedEvmDeployment(input.profileDeployments);
}
export function isMetaplexTradeable(
  metaplex: Pick<
    MetaplexDetailPayload,
    | "tradeUrl"
    | "launchStatus"
    | "hasDexPair"
  >,
  dexPair?: MetaplexDexPair | null,
): boolean {
  return computeMetaplexTradeable({
    tradeUrl: metaplex.tradeUrl,
    launchStatus: metaplex.launchStatus,
    hasDexPair: metaplex.hasDexPair === true || Boolean(dexPair),
  });
}