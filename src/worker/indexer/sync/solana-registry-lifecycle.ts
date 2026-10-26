import type { Prisma } from "@/generated/prisma/client";
import { SOLANA_CHAIN_ID } from "../chain-constants";
import { derivePublicActivation } from "../lib/public-activation";

const LIFECYCLE_BATCH_SIZE = 5_000;

async function refreshAgentLifecycleBatch(
  tx: Prisma.TransactionClient,
  agentDbIds: readonly number[],
): Promise<void> {
  const [memberships, agents] = await Promise.all([
    tx.solanaRegistryMembership.findMany({
      where: { agentDbId: { in: [...agentDbIds] }, isCurrent: true },
      select: { agentDbId: true, sourceActive: true },
    }),
    tx.agent.findMany({
      where: { id: { in: [...agentDbIds] } },
      select: {
        id: true,
        chainId: true,
        sapAgentPda: true,
        moderationStatus: true,
        administrativeActiveOverride: true,
        sourceActive: true,
        sourceLifecycleStatus: true,
        publiclyActive: true,
        isActive: true,
      },
    }),
  ]);
  const membershipState = new Map<number, { count: number; anySourceActive: boolean }>();
  for (const membership of memberships) {
    const state = membershipState.get(membership.agentDbId) ?? { count: 0, anySourceActive: false };
    state.count += 1;
    state.anySourceActive ||= membership.sourceActive !== false;
    membershipState.set(membership.agentDbId, state);
  }
  const groups = new Map<string, {
    ids: number[];
    sourceActive: boolean;
    sourceLifecycleStatus: string;
    publiclyActive: boolean;
  }>();
  for (const agent of agents) {
    // A cross-chain twin keeps its canonical EVM lifecycle. Solana memberships
    // enrich that row but must not replace the source lifecycle owned by its
    // configured chain indexer. SAP identities likewise own their lifecycle.
    if (agent.chainId !== SOLANA_CHAIN_ID || agent.sapAgentPda?.trim()) continue;
    const state = membershipState.get(agent.id);
    const hasCurrentSource = (state?.count ?? 0) > 0;
    const sourceActive = hasCurrentSource && state?.anySourceActive === true;
    const publiclyActive = derivePublicActivation({
      sourceActive,
      moderationStatus: agent.moderationStatus,
      administrativeOverride: agent.administrativeActiveOverride,
      complete: hasCurrentSource,
    });
    const sourceLifecycleStatus = hasCurrentSource
      ? "current"
      : "not-present-in-latest-snapshot";
    if (
      agent.sourceActive === sourceActive &&
      agent.sourceLifecycleStatus === sourceLifecycleStatus &&
      agent.publiclyActive === publiclyActive &&
      agent.isActive === publiclyActive
    ) continue;
    const key = `${sourceActive ? 1 : 0}:${publiclyActive ? 1 : 0}:${sourceLifecycleStatus}`;
    const group = groups.get(key) ?? {
      ids: [],
      sourceActive,
      sourceLifecycleStatus,
      publiclyActive,
    };
    group.ids.push(agent.id);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    for (let offset = 0; offset < group.ids.length; offset += LIFECYCLE_BATCH_SIZE) {
      await tx.agent.updateMany({
        where: { id: { in: group.ids.slice(offset, offset + LIFECYCLE_BATCH_SIZE) } },
        data: {
          sourceActive: group.sourceActive,
          sourceLifecycleStatus: group.sourceLifecycleStatus,
          publiclyActive: group.publiclyActive,
          isActive: group.publiclyActive,
        },
      });
    }
  }
}

export async function refreshSolanaRegistryAgentLifecycles(
  tx: Prisma.TransactionClient,
  agentDbIds: readonly number[],
  options: { alreadyUnique?: boolean } = {},
): Promise<void> {
  const uniqueIds = options.alreadyUnique
    ? agentDbIds
    : [...new Set(agentDbIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  for (let offset = 0; offset < uniqueIds.length; offset += LIFECYCLE_BATCH_SIZE) {
    await refreshAgentLifecycleBatch(
      tx,
      uniqueIds.slice(offset, offset + LIFECYCLE_BATCH_SIZE),
    );
  }
}

export async function refreshSolanaRegistryAgentLifecycle(
  tx: Prisma.TransactionClient,
  agentDbId: number,
): Promise<void> {
  await refreshSolanaRegistryAgentLifecycles(tx, [agentDbId]);
}
