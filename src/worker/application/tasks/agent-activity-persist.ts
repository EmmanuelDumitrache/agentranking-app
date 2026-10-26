import type { Prisma } from "@/generated/prisma/client";
import type { AgentActivityPersistPayload } from "@/jobs/contracts";
import { computeActivityRollup, type NormalizedActivityItem } from "@/lib/blockchain/fetch-activity";
import { prisma } from "@/lib/db";
import { recordTrustEventInTx } from "@/lib/trust-event-store";
function explorerAccountUrl(chainId: number, wallet: string): string {
  if (chainId === 900001) return `https://solscan.io/account/${wallet}`;
  if (chainId === 8453) return `https://basescan.org/address/${wallet}`;
  return `https://etherscan.io/address/${wallet}`;
}
export async function persistAgentActivityJob(payload: AgentActivityPersistPayload) {
  const fetchedAt = new Date(payload.fetchedAt);
  const activity: NormalizedActivityItem[] = payload.activity.map((item) => ({
    ...item,
    timestamp: new Date(item.timestamp),
  }));
  const rollup = computeActivityRollup(activity);
  const recentTx = activity[0]?.txSignatureOrHash?.trim() ?? "";
  return prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findUnique({
      where: { id: payload.agentId },
      select: {
        id: true,
        verifiedWallet: true,
        verifiedWalletChainId: true,
        activityUpdatedAt: true,
      },
    });
    if (!agent) return { ok: true, skipped: "agent_missing" };
    if (agent.verifiedWallet?.toLowerCase() !== payload.verifiedWallet.toLowerCase()) {
      return { ok: true, skipped: "verified_wallet_changed" };
    }
    const currentChainId = agent.verifiedWalletChainId ?? payload.walletChainId;
    if (currentChainId !== payload.walletChainId) {
      return { ok: true, skipped: "verified_wallet_chain_changed" };
    }
    if (agent.activityUpdatedAt && agent.activityUpdatedAt >= fetchedAt) {
      return { ok: true, skipped: "stale_fetch" };
    }
    await tx.agent.update({
      where: { id: agent.id },
      data: {
        recentActivity: payload.activity as unknown as Prisma.InputJsonValue,
        activityUpdatedAt: fetchedAt,
        activeWinRate30d: rollup.activeWinRate30d,
        nativeVolume30d: rollup.nativeVolume30d,
      },
    });
    if (recentTx) {
      await recordTrustEventInTx(tx, {
        agentId: agent.id,
        eventType: "on_chain_tx",
        scoreDelta: 0,
        evidenceUrl: explorerAccountUrl(payload.walletChainId, payload.verifiedWallet),
        onChainTx: recentTx,
        eventKey: `on_chain_tx:${agent.id}:${payload.walletChainId}:${recentTx}`,
        timestamp: activity[0]?.timestamp ?? fetchedAt,
      });
    }
    return {
      ok: true,
      persisted: true,
      activityCount: activity.length,
      trustEventRecorded: Boolean(recentTx),
    };
  });
}
