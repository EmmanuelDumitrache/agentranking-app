import type { Prisma } from "@/generated/prisma/client";
import { classifyWallet } from "@/lib/trust-oracle-logic";

const PRO_SUBSCRIPTION_DAYS = 30;

export type ProSubscriptionIdentity = {
  email: string;
  wallet: string;
  helioSubscriptionId?: string | null;
};

type ProfileMatch = {
  id: number;
  email: string | null;
  walletAddress: string | null;
  solanaWallet: string | null;
  subscriptionExpiresAt: Date | null;
  subscriptionStartedAt: Date | null;
};

function normalizedIdentity(input: ProSubscriptionIdentity) {
  const email = input.email.trim().toLowerCase();
  const rawWallet = input.wallet.trim();
  const walletKind = classifyWallet(rawWallet);
  const wallet = walletKind === "evm" ? rawWallet.toLowerCase() : rawWallet;
  return { email, wallet, walletKind };
}

function profileIdentityWhere(input: ProSubscriptionIdentity): Prisma.UserProfileWhereInput[] {
  const { email, wallet, walletKind } = normalizedIdentity(input);
  const candidates: Prisma.UserProfileWhereInput[] = [];
  if (email) candidates.push({ email: { equals: email, mode: "insensitive" } });
  if (walletKind === "evm") {
    candidates.push({ walletAddress: { equals: wallet, mode: "insensitive" } });
  } else if (walletKind === "solana") {
    candidates.push({ solanaWallet: wallet }, { walletAddress: wallet });
  }
  return candidates;
}

async function findSubscriptionProfile(
  tx: Prisma.TransactionClient,
  input: ProSubscriptionIdentity,
): Promise<ProfileMatch | null> {
  const identity = normalizedIdentity(input);
  const { email, wallet } = identity;
  const identityWhere = profileIdentityWhere(input);
  if (input.helioSubscriptionId) {
    const bySubscription = await tx.userProfile.findFirst({
      where: { helioSubscriptionId: input.helioSubscriptionId },
      select: {
        id: true,
        email: true,
        walletAddress: true,
        solanaWallet: true,
        subscriptionExpiresAt: true,
        subscriptionStartedAt: true,
      },
    });
    if (bySubscription) return bySubscription;
  }
  if (identityWhere.length === 0) return null;
  const rows = await tx.userProfile.findMany({
    where: { OR: identityWhere },
    select: {
      id: true,
      email: true,
      walletAddress: true,
      solanaWallet: true,
      subscriptionExpiresAt: true,
      subscriptionStartedAt: true,
    },
    orderBy: { id: "asc" },
  });
  return rows.find((row) => row.email?.toLowerCase() === email)
    ?? rows.find((row) => identity.walletKind === "evm"
      ? row.walletAddress?.toLowerCase() === wallet
      : row.walletAddress === wallet)
    ?? rows.find((row) => row.solanaWallet === wallet)
    ?? null;
}

export async function activateProSubscriptionInTx(
  tx: Prisma.TransactionClient,
  input: ProSubscriptionIdentity,
  now = new Date(),
): Promise<{ profileId: number; expiresAt: Date }> {
  const identity = normalizedIdentity(input);
  const existing = await findSubscriptionProfile(tx, input);
  const currentExpiry = existing?.subscriptionExpiresAt;
  const extensionBase = currentExpiry && currentExpiry > now ? currentExpiry : now;
  const expiresAt = new Date(extensionBase.getTime() + PRO_SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1_000);
  const subscriptionData = {
    subscriptionStatus: "active",
    subscriptionPlan: "pro",
    subscriptionExpiresAt: expiresAt,
    subscriptionStartedAt: existing?.subscriptionStartedAt ?? now,
    ...(input.helioSubscriptionId ? { helioSubscriptionId: input.helioSubscriptionId } : {}),
  };
  if (existing) {
    const updated = await tx.userProfile.update({
      where: { id: existing.id },
      data: subscriptionData,
      select: { id: true },
    });
    return { profileId: updated.id, expiresAt };
  }
  if (!identity.email && !identity.walletKind) {
    throw new Error("Subscription payment has no usable email or wallet identity");
  }
  const created = await tx.userProfile.create({
    data: {
      ...(identity.email ? { email: identity.email } : {}),
      ...(identity.walletKind === "evm" ? { walletAddress: identity.wallet } : {}),
      ...(identity.walletKind === "solana" ? { solanaWallet: identity.wallet } : {}),
      ...subscriptionData,
    },
    select: { id: true },
  });
  return { profileId: created.id, expiresAt };
}

export async function endProSubscriptionInTx(
  tx: Prisma.TransactionClient,
  input: ProSubscriptionIdentity,
): Promise<number | null> {
  const existing = await findSubscriptionProfile(tx, input);
  if (!existing) return null;
  await tx.userProfile.update({
    where: { id: existing.id },
    data: { subscriptionStatus: "expired" },
  });
  return existing.id;
}
