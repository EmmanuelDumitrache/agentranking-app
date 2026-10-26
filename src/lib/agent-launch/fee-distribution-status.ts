import "server-only";

import { prisma } from "@/lib/db";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";

export type AgentLaunchFeeDistributionStatus = {
  status: "idle" | "queued" | "in_progress" | "distributed" | "failed" | "skipped";
  launchId: string;
  mint: string | null;
  txSignature: string | null;
  totalAmount: string | null;
  creatorAmount: string | null;
  arAmount: string | null;
  reason: string | null;
  attempt: {
    id: string;
    mode: string;
    status: string;
    txSignature: string;
    lastError: string | null;
    updatedAt: string;
  } | null;
  launch: ReturnType<typeof serializeAgentLaunch>;
};

export async function getAgentLaunchFeeDistributionStatus(
  launchId: string,
): Promise<AgentLaunchFeeDistributionStatus | null> {
  const launch = await prisma.agentLaunch.findUnique({
    where: { id: launchId },
    include: {
      distributionAttempts: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      distributions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!launch) return null;

  const attempt = launch.distributionAttempts[0] ?? null;
  const distribution = launch.distributions[0] ?? null;
  const attemptIsNewer = Boolean(
    attempt && (!distribution || attempt.createdAt > distribution.createdAt),
  );

  let status: AgentLaunchFeeDistributionStatus["status"] = "idle";
  let reason: string | null = null;
  if (attempt?.status === "prepared" || attempt?.status === "submitted") {
    status = "in_progress";
    reason = attempt.lastError;
  } else if (attempt?.status === "failed" && attemptIsNewer) {
    status = "failed";
    reason = attempt.lastError ?? "distribution_attempt_failed";
  } else if (attempt?.status === "confirmed" && !distribution) {
    status = "failed";
    reason = "confirmed_attempt_missing_distribution";
  } else if (distribution) {
    status = "distributed";
  }

  return {
    status,
    launchId: launch.id,
    mint: launch.mint,
    txSignature: distribution?.txSignature ?? attempt?.txSignature ?? null,
    totalAmount: distribution?.totalAmount.toString() ?? null,
    creatorAmount: distribution?.creatorAmount.toString() ?? null,
    arAmount: distribution?.arAmount.toString() ?? null,
    reason,
    attempt: attempt
      ? {
          id: attempt.id,
          mode: attempt.mode,
          status: attempt.status,
          txSignature: attempt.txSignature,
          lastError: attempt.lastError,
          updatedAt: attempt.updatedAt.toISOString(),
        }
      : null,
    launch: serializeAgentLaunch(launch),
  };
}
