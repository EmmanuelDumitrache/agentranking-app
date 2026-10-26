import { prisma } from "@/lib/db";
import { getOrInsertComputed } from "@/lib/map-upsert";
const SIGNAL_OK = new Set(["verified", "detected", "partner_registered"]);
export type VerifiedListEnrichment = {
  serviceCount: number;
  devProofActive: boolean;
  x402Detected: boolean;
  x402Payable: boolean;
  githubConnected: boolean;
  devProofLastPushAt: string | null;
  devProofLatestPushMessage: string | null;
};
export async function enrichVerifiedAgentsList(
  agentDbIds: number[],
): Promise<Map<number, VerifiedListEnrichment>> {
  if (agentDbIds.length === 0) return new Map();
  const [serviceCounts, signals, githubConnections, snapshots] = await Promise.all([
    prisma.agentService.groupBy({
      by: ["agentId"],
      where: { agentId: { in: agentDbIds } },
      _count: { _all: true },
    }),
    prisma.agentVerificationSignal.findMany({
      where: {
        agentId: { in: agentDbIds },
        signalType: { in: ["devproof_active", "x402_detected", "x402_payable"] },
      },
      select: { agentId: true, signalType: true, status: true },
    }),
    prisma.agentGithubConnection.findMany({
      where: { agentId: { in: agentDbIds }, status: "active" },
      select: { agentId: true },
    }),
    prisma.agentGithubSnapshot.findMany({
      where: { agentId: { in: agentDbIds } },
      select: { agentId: true, lastCommitAt: true, payloadJson: true, capturedAt: true },
      orderBy: { capturedAt: "desc" },
      distinct: ["agentId"],
    }),
  ]);
  const serviceCountByAgent = new Map(
    serviceCounts.map((row) => [row.agentId, row._count._all]),
  );
  const signalsByAgent = new Map<number, Array<{ signalType: string; status: string }>>();
  for (const signal of signals) {
    getOrInsertComputed(signalsByAgent, signal.agentId, () => []).push(signal);
  }
  const activeGithub = new Set(githubConnections.map((row) => row.agentId));
  const snapshotAgents = new Set(snapshots.map((row) => row.agentId));
  function latestPushMessage(payloadJson: unknown): string | null {
    if (!payloadJson || typeof payloadJson !== "object" || Array.isArray(payloadJson)) return null;
    const recent = (payloadJson as { recentCommits?: unknown }).recentCommits;
    if (!Array.isArray(recent) || recent.length === 0) return null;
    const first = recent[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) return null;
    const message = (first as { message?: unknown }).message;
    return typeof message === "string" && message.trim() ? message.trim() : null;
  }
  const snapshotByAgent = new Map(
    snapshots.map((row) => [
      row.agentId,
      {
        lastPushAt: row.lastCommitAt?.toISOString() ?? null,
        latestMessage: latestPushMessage(row.payloadJson),
      },
    ]),
  );
  const result = new Map<number, VerifiedListEnrichment>();
  for (const agentDbId of agentDbIds) {
    const agentSignals = signalsByAgent.get(agentDbId) ?? [];
    const has = (type: string) =>
      agentSignals.some((s) => s.signalType === type && SIGNAL_OK.has(s.status));
    const snap = snapshotByAgent.get(agentDbId);
    result.set(agentDbId, {
      serviceCount: serviceCountByAgent.get(agentDbId) ?? 0,
      devProofActive: has("devproof_active"),
      x402Detected: has("x402_detected"),
      x402Payable: has("x402_payable"),
      githubConnected: activeGithub.has(agentDbId) && snapshotAgents.has(agentDbId),
      devProofLastPushAt: snap?.lastPushAt ?? null,
      devProofLatestPushMessage: snap?.latestMessage ?? null,
    });
  }
  return result;
}
export function applyVerifiedListEnrichment<T extends { id: number }>(
  rows: T[],
  enrichment: Map<number, VerifiedListEnrichment>,
): Array<T & VerifiedListEnrichment> {
  return rows.map((row) => {
    const extra = enrichment.get(Number(row.id));
    return {
      ...row,
      serviceCount: extra?.serviceCount ?? 0,
      devProofActive: extra?.devProofActive ?? false,
      x402Detected: extra?.x402Detected ?? false,
      x402Payable: extra?.x402Payable ?? false,
      githubConnected: extra?.githubConnected ?? false,
      devProofLastPushAt: extra?.devProofLastPushAt ?? null,
      devProofLatestPushMessage: extra?.devProofLatestPushMessage ?? null,
    };
  });
}
