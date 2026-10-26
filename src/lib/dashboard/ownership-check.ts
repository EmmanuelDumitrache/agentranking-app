import { prisma } from "@/lib/db";
import { classifyWallet } from "@/lib/trust-oracle-logic";
/**
 * Wallet-scoped ownership: on-chain owner, linked verified execution wallet,
 * SAP operator claim, or matching profile `solanaWallet` to agent SAP owner.
 */
export async function dashboardUserOwnsAgentDbId(
  walletRaw: string | null | undefined,
  agentDbId: number,
  userProfileId?: number | null,
) {
  const wallet = (walletRaw ?? "").trim();
  const walletKind = classifyWallet(wallet);
  if (walletKind) {
    const normalized = walletKind === "evm" ? wallet.toLowerCase() : wallet;
    const ownerWhere = walletKind === "evm"
      ? { owner: { equals: normalized, mode: "insensitive" as const } }
      : { owner: normalized };
    const verifiedWalletWhere = walletKind === "evm"
      ? { verifiedWallet: { equals: normalized, mode: "insensitive" as const } }
      : { verifiedWallet: normalized };
    const base = await prisma.agent.findFirst({
      where: {
        id: agentDbId,
        OR: [
          ownerWhere,
          { AND: [{ verifiedWallet: { not: "" } }, verifiedWalletWhere] },
        ],
      },
      select: { id: true, name: true },
    });
    if (base) return base;
  }
  if (userProfileId != null) {
    const byClaim = await prisma.agent.findFirst({
      where: { id: agentDbId, sapOperatorClaim: { userProfileId } },
      select: { id: true, name: true },
    });
    if (byClaim) return byClaim;
    const profile = await prisma.userProfile.findUnique({
      where: { id: userProfileId },
      select: { solanaWallet: true },
    });
    const sw = profile?.solanaWallet?.trim();
    if (sw) {
      const bySol = await prisma.agent.findFirst({
        where: {
          id: agentDbId,
          OR: [
            { sapOwnerWallet: sw },
            { owner: sw },
          ],
        },
        select: { id: true, name: true },
      });
      if (bySol) return bySol;
    }
  }
  return null;
}
