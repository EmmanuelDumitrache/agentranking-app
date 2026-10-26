import { getPublicAgentVerificationStatus } from "@/lib/public-site/agent-verification";
import type { DashboardAgentSummary } from "@/lib/dashboard/types";

export function isDashboardAgentVerified(
  agent: Pick<
    DashboardAgentSummary,
    "arVerificationStatus" | "isVerified" | "isPremiumVerified"
  >,
  accountIsVerified: boolean,
): boolean {
  return getPublicAgentVerificationStatus({
    ownerAccountVerified: accountIsVerified,
    arVerificationStatus: agent.arVerificationStatus,
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified,
  }).isVerified;
}

export type DashboardAgentIdentityStatus = {
  isVerified: boolean;
  isPending: boolean;
  isRegistered: boolean;
  subtitle: string;
};

export function getDashboardAgentIdentityStatus(
  agent: Pick<
    DashboardAgentSummary,
    | "arVerificationStatus"
    | "isVerified"
    | "isPremiumVerified"
    | "isSolanaRegistered"
  >,
  accountIsVerified = false,
): DashboardAgentIdentityStatus {
  const isVerified = isDashboardAgentVerified(agent, accountIsVerified);
  const isPending =
    !isVerified && (agent.arVerificationStatus ?? "").toLowerCase() === "pending";
  const isRegistered = agent.isSolanaRegistered;

  const labels: string[] = [];
  if (isVerified) {
    labels.push("Verified");
  } else if (isPending) {
    labels.push("Verification pending");
  }
  if (isRegistered) {
    labels.push("Registered on Solana");
  }
  if (labels.length === 0) {
    labels.push("Unverified");
  }

  return {
    isVerified,
    isPending,
    isRegistered,
    subtitle: labels.join(" · "),
  };
}
