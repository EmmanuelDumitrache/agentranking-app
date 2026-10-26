import type { Prisma } from "@/generated/prisma/client";
import {
  HATCHER_CHAIN_ID,
  HATCHER_ID_METADATA_KEY,
  HATCHER_LISTING_REGISTRY_SOURCE,
} from "@/lib/hatcher/config";
import type { HatcherDetailPayload } from "@/lib/hatcher/types";
export function isHatcherChainId(chainId: number): boolean {
  return chainId === HATCHER_CHAIN_ID;
}
export function isHatcherAgent(input: {
  chainId?: number;
  listingRegistrySource?: string | null;
  metadata?: Array<{ key: string; value: string }>;
}): boolean {
  if (input.chainId != null && isHatcherChainId(input.chainId)) return true;
  if (input.listingRegistrySource === HATCHER_LISTING_REGISTRY_SOURCE) return true;
  return metadataHasHatcherId(input.metadata);
}
function metadataHasHatcherId(
  metadata: Array<{ key: string; value: string }> | null | undefined,
): boolean {
  if (!metadata?.length) return false;
  return metadata.some(
    (m) => m.key.trim().toLowerCase() === HATCHER_ID_METADATA_KEY.toLowerCase() && m.value.trim().length > 0,
  );
}
/** Prisma filter for /hatcher hub and ?hatcher=true listings. */
export function hatcherAgentListingWhere(): Prisma.AgentWhereInput {
  return {
    isActive: true,
    OR: [
      { chainId: HATCHER_CHAIN_ID },
      { listingRegistrySource: HATCHER_LISTING_REGISTRY_SOURCE },
      { metadata: { some: { key: HATCHER_ID_METADATA_KEY } } },
    ],
  };
}
/** Show Hatcher partner UI for indexed Hatcher identities. */
export function showHatcherUi(input: {
  chainId?: number;
  listingRegistrySource?: string | null;
  hatcher?: HatcherDetailPayload | null;
  metadata?: Array<{ key: string; value: string }>;
}): boolean {
  if (input.hatcher?.isHatcher === true) return true;
  return isHatcherAgent({
    chainId: input.chainId,
    listingRegistrySource: input.listingRegistrySource,
    metadata: input.metadata,
  });
}
