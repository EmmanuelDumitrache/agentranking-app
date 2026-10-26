import type { Prisma } from "@/generated/prisma/client";
import { SOLANA_CHAIN_ID } from "../chain-constants";
import { SOLANA_REGISTRY_SOURCE, type SolanaRegistrySource } from "./solana-current-state-types";
type ExactAgentCandidate = {
  id: number;
  chainId: number;
  sapAgentPda: string | null;
  solanaAssetAddress: string | null;
  metaplexAssetAddress: string | null;
};
function isIndependentIdentity(candidate: ExactAgentCandidate): boolean {
  return candidate.chainId !== SOLANA_CHAIN_ID || Boolean(candidate.sapAgentPda?.trim());
}
export async function assertSolanaRegistryAssetAttachable(
  tx: Prisma.TransactionClient,
  input: { agentDbId: number; source: SolanaRegistrySource; assetAddress: string },
): Promise<void> {
  const assetAddress = input.assetAddress.trim();
  if (!assetAddress) throw new Error("Solana registry asset address is required");
  const [memberships, agent] = await Promise.all([
    tx.solanaRegistryMembership.findMany({
      where: {
        agentDbId: input.agentDbId,
        source: input.source,
      },
      select: { externalId: true, isCurrent: true },
    }),
    tx.agent.findUnique({
      where: { id: input.agentDbId },
      select: { solanaAssetAddress: true, metaplexAssetAddress: true },
    }),
  ]);
  if (!agent) throw new Error(`Agent ${input.agentDbId} does not exist`);
  const materializedAsset = input.source === SOLANA_REGISTRY_SOURCE.SOLANA_8004
    ? agent.solanaAssetAddress
    : agent.metaplexAssetAddress;
  const conflictingMembership = memberships.find(
    (membership) => membership.isCurrent && membership.externalId !== assetAddress,
  );
  // A materialized column without any membership history can only come from a
  // rolling-deployment/legacy writer, so retain it as a conservative conflict.
  // Once history exists, a non-current old asset must not block a later current
  // identity from attaching to the same canonical Agent.
  const legacyMaterializedConflict = memberships.length === 0 &&
    materializedAsset?.trim() && materializedAsset !== assetAddress
    ? materializedAsset
    : null;
  const conflictingAsset = conflictingMembership?.externalId ?? legacyMaterializedConflict;
  if (conflictingAsset) {
    throw new Error(
      `Agent ${input.agentDbId} already has current ${input.source} asset ${conflictingAsset}; refusing ${assetAddress}`,
    );
  }
}
/**
 * Converges exact Core-asset matches before either source materializes data.
 *
 * Historical versions could create one Solana 8004 row and one Metaplex row for the
 * same asset because the two unique address columns are independent. A unique
 * non-Solana/SAP identity always wins; otherwise the current Solana 8004 membership
 * is preferred as the canonical Solana profile authority. Only redundant,
 * Solana-native rows without a SAP identity are retired automatically.
 */
export async function convergeSolanaRegistryAssetRows(
  tx: Prisma.TransactionClient,
  input: { assetAddress: string; preferredSource: SolanaRegistrySource },
): Promise<number | null> {
  const assetAddress = input.assetAddress.trim();
  if (!assetAddress) throw new Error("Solana registry asset address is required");
  const [memberships, exactRows] = await Promise.all([
    tx.solanaRegistryMembership.findMany({
      where: {
        externalId: assetAddress,
        source: {
          in: [
            SOLANA_REGISTRY_SOURCE.SOLANA_8004,
            SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
          ],
        },
      },
      select: {
        source: true,
        isCurrent: true,
        agent: {
          select: {
            id: true,
            chainId: true,
            sapAgentPda: true,
            solanaAssetAddress: true,
            metaplexAssetAddress: true,
          },
        },
      },
    }),
    tx.agent.findMany({
      where: {
        OR: [
          { solanaAssetAddress: assetAddress },
          { metaplexAssetAddress: assetAddress },
        ],
      },
      select: {
        id: true,
        chainId: true,
        sapAgentPda: true,
        solanaAssetAddress: true,
        metaplexAssetAddress: true,
      },
    }),
  ]);
  const candidates = new Map<number, ExactAgentCandidate>();
  for (const row of exactRows) candidates.set(row.id, row);
  for (const membership of memberships) candidates.set(membership.agent.id, membership.agent);
  if (candidates.size === 0) return null;
  const independent = [...candidates.values()].filter(isIndependentIdentity);
  if (independent.length > 1) {
    throw new Error(
      `Core asset ${assetAddress} is attached to multiple independent agent identities: ${independent.map((row) => row.id).join(", ")}`,
    );
  }
  const membershipAgentId = (source: SolanaRegistrySource, currentOnly: boolean): number | null =>
    memberships.find((membership) =>
      membership.source === source && (!currentOnly || membership.isCurrent),
    )?.agent.id ?? null;
  const rowWithSolanaAsset = exactRows.find((row) => row.solanaAssetAddress === assetAddress)?.id ?? null;
  const rowWithMetaplexAsset = exactRows.find((row) => row.metaplexAssetAddress === assetAddress)?.id ?? null;
  const canonicalId = independent[0]?.id ??
    membershipAgentId(SOLANA_REGISTRY_SOURCE.SOLANA_8004, true) ??
    membershipAgentId(input.preferredSource, true) ??
    rowWithSolanaAsset ??
    membershipAgentId(input.preferredSource, false) ??
    rowWithMetaplexAsset ??
    [...candidates.keys()][0]!;
  const hasSolana8004Identity = rowWithSolanaAsset != null || memberships.some(
    (membership) => membership.source === SOLANA_REGISTRY_SOURCE.SOLANA_8004,
  );
  const hasMetaplexIdentity = rowWithMetaplexAsset != null || memberships.some(
    (membership) => membership.source === SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
  );
  if (hasSolana8004Identity) {
    await assertSolanaRegistryAssetAttachable(tx, {
      agentDbId: canonicalId,
      source: SOLANA_REGISTRY_SOURCE.SOLANA_8004,
      assetAddress,
    });
  }
  if (hasMetaplexIdentity) {
    await assertSolanaRegistryAssetAttachable(tx, {
      agentDbId: canonicalId,
      source: SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
      assetAddress,
    });
  }
  for (const duplicate of candidates.values()) {
    if (duplicate.id === canonicalId) continue;
    if (isIndependentIdentity(duplicate)) {
      throw new Error(
        `Refusing to merge independent agent ${duplicate.id} into agent ${canonicalId} for Core asset ${assetAddress}`,
      );
    }
    await tx.solanaRegistryMembership.updateMany({
      where: {
        agentDbId: duplicate.id,
        externalId: assetAddress,
        source: {
          in: [
            SOLANA_REGISTRY_SOURCE.SOLANA_8004,
            SOLANA_REGISTRY_SOURCE.METAPLEX_AGENT_REGISTRY,
          ],
        },
      },
      data: { agentDbId: canonicalId },
    });
    const remainingCurrentMembership = await tx.solanaRegistryMembership.findFirst({
      where: { agentDbId: duplicate.id, isCurrent: true },
      select: { id: true },
    });
    await tx.agent.update({
      where: { id: duplicate.id },
      data: {
        ...(duplicate.solanaAssetAddress === assetAddress ? { solanaAssetAddress: null } : {}),
        ...(duplicate.metaplexAssetAddress === assetAddress ? { metaplexAssetAddress: null } : {}),
        ...(!remainingCurrentMembership
          ? {
              sourceActive: false,
              publiclyActive: false,
              isActive: false,
              sourceLifecycleStatus: "merged-registry-duplicate",
            }
          : {}),
      },
    });
  }
  await tx.agent.update({
    where: { id: canonicalId },
    data: {
      ...(hasSolana8004Identity ? { solanaAssetAddress: assetAddress } : {}),
      ...(hasMetaplexIdentity ? { metaplexAssetAddress: assetAddress } : {}),
    },
  });
  return canonicalId;
}
