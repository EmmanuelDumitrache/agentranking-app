import type { Prisma } from "@/generated/prisma/client";
import type { MetaplexAgentsListFilters } from "@/lib/metaplex/types";
import { METAPLEX_LISTING_REGISTRY_SOURCE } from "@/lib/metaplex/config";
import type { MetaplexDetailPayload } from "@/lib/metaplex/types";
export function isMetaplexAgent(input: {
  listingRegistrySource?: string | null;
  metaplexAssetAddress?: string | null;
  metaplexVerified?: boolean | null;
}): boolean {
  if (input.listingRegistrySource === METAPLEX_LISTING_REGISTRY_SOURCE) return true;
  if (input.metaplexAssetAddress?.trim()) return true;
  return input.metaplexVerified === true;
}
export function isMetaplexPrimaryListing(input: {
  listingRegistrySource?: string | null;
  metaplexAssetAddress?: string | null;
  metaplexVerified?: boolean | null;
}): boolean {
  return isMetaplexAgent(input) && input.listingRegistrySource === METAPLEX_LISTING_REGISTRY_SOURCE;
}
/** Prisma filter for /ranking?metaplex=true and API listings. */
export function metaplexAgentListingWhere(): Prisma.AgentWhereInput {
  return {
    isActive: true,
    OR: [
      { listingRegistrySource: METAPLEX_LISTING_REGISTRY_SOURCE },
      { metaplexAssetAddress: { not: null } },
      { metaplexVerified: true },
    ],
  };
}
export function showMetaplexUi(input: {
  listingRegistrySource?: string | null;
  metaplex?: MetaplexDetailPayload | null;
  metaplexAssetAddress?: string | null;
  metaplexVerified?: boolean | null;
}): boolean {
  if (input.metaplex?.isMetaplex === true) return true;
  return isMetaplexAgent({
    listingRegistrySource: input.listingRegistrySource,
    metaplexAssetAddress: input.metaplexAssetAddress,
    metaplexVerified: input.metaplexVerified,
  });
}
/** Compose listing where + optional Metaplex directory filters. */
export function buildMetaplexAgentsListWhere(
  filters: MetaplexAgentsListFilters = {},
): Prisma.AgentWhereInput {
  const and: Prisma.AgentWhereInput[] = [metaplexAgentListingWhere()];
  if (filters.tradeable) {
    and.push({
      OR: [
        { metaplexTradeUrl: { not: null } },
        { metaplexLaunchStatus: { in: ["active", "live", "trading", "open"] } },
        { metaplexHasDexPair: true },
      ],
    });
  }
  if (filters.boundToken) {
    and.push({ metaplexAgentTokenMint: { not: null } });
  }
  if (filters.hasServices) {
    and.push({ services: { some: {} } });
  }
  if (filters.active) {
    and.push({ metaplexActive: true });
  }
  if (filters.registryDetected) {
    and.push({ metaplexVerified: true });
  }
  return and.length === 1 ? and[0]! : { AND: and };
}
