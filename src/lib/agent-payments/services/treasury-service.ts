import { ensureAppAccountForProfile } from "@/lib/custodial-wallet/bootstrap";
import { prisma } from "@/lib/db";
import { ensureSpendingPolicy } from "./spending-policy-service";
import { ensureTreasuryWallet, getWalletBalance } from "./wallet-service";
import { getCard } from "./card-service";

/**
 * Bootstrap treasury stack for an AppAccount:
 * wallet (0 USDC) + default spending policy.
 */
export async function ensureTreasuryForAppAccount(appAccountId: string) {
  const wallet = await ensureTreasuryWallet(appAccountId);
  const policy = await ensureSpendingPolicy(appAccountId);
  const card = await getCard(appAccountId);
  return { wallet, policy, card };
}

export async function resolveTreasuryContext(profile: {
  id: number;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}) {
  const account = await ensureAppAccountForProfile({
    id: profile.id,
    displayName: profile.displayName,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
  });
  const treasury = await ensureTreasuryForAppAccount(account.id);
  const balance = await getWalletBalance(account.id);
  return { account, ...treasury, balance };
}

export async function getTreasuryDashboard(appAccountId: string) {
  const [balance, card, policy, agents, recent] = await Promise.all([
    getWalletBalance(appAccountId),
    getCard(appAccountId),
    ensureSpendingPolicy(appAccountId),
    prisma.agent.findMany({
      where: { ownerAccountId: appAccountId, isActive: true },
      select: { id: true, name: true, image: true },
      take: 20,
      orderBy: { createdAt: "desc" },
    }),
    prisma.treasuryTransaction.findMany({
      where: { appAccountId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { agent: { select: { id: true, name: true } } },
    }),
  ]);

  return { balance, card, policy, agents, recent };
}
