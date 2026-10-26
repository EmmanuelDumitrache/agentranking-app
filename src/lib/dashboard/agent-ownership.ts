import type { Prisma } from "@/generated/prisma/client";
export type DashboardProfileWallets = {
  id: number;
  walletAddress: string | null;
  solanaWallet: string | null;
};
/** Build Prisma OR filter for agents owned/manageable by a dashboard profile. */
export function buildOwnedAgentsWhere(profile: DashboardProfileWallets): Prisma.AgentWhereInput {
  const w = profile.walletAddress?.trim() ?? "";
  const sol = profile.solanaWallet?.trim() ?? "";
  const or: Prisma.AgentWhereInput[] = [
    { sapOperatorClaim: { userProfileId: profile.id } },
  ];
  if (w) {
    const isEvm = /^0x[0-9a-fA-F]{40}$/.test(w);
    const wallet = isEvm ? w.toLowerCase() : w;
    const walletFilter = isEvm
      ? { equals: wallet, mode: "insensitive" as const }
      : wallet;
    or.push(
      { owner: walletFilter },
      {
        AND: [
          { verifiedWallet: { not: "" } },
          { verifiedWallet: walletFilter },
        ],
      },
      {
        metadata: {
          some: { key: "agentWallet", value: walletFilter },
        },
      },
      {
        orders: {
          some: {
            wallet: walletFilter,
            status: "paid",
            productType: { in: ["kya_verify", "verification_bundle"] },
          },
        },
      },
    );
  }
  if (sol) {
    or.push(
      { sapOwnerWallet: sol },
      { owner: sol },
      {
        orders: {
          some: {
            wallet: sol,
            status: "paid",
            productType: { in: ["kya_verify", "verification_bundle"] },
          },
        },
      },
    );
  }
  return { OR: or };
}
export function isAgentVerifiedForDashboard(
  agent: {
    isVerified: boolean;
    isPremiumVerified: boolean;
    arVerificationStatus: string;
  },
  accountIsVerified = false,
): boolean {
  if (accountIsVerified) return true;
  if (agent.isPremiumVerified || agent.isVerified) return true;
  return agent.arVerificationStatus === "verified";
}
