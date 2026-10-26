import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
import { sanitizeForPostgres } from "@/lib/utils";
import { readDefaultAccountCredits, readMaxAgentsForAccount } from "@/lib/custodial-wallet/config";
import { generateAccountPublicId } from "@/lib/verification/public-id";
import { provisionCustodialSolanaWallet } from "@/lib/custodial-wallet/provision";
import { loadAgentCustodialWalletPublicKey, loadAgentWalletProvisionRow, loadCustodialPublicKeyByWalletId, loadAgentWalletIdInTx, attachAgentWalletInTx, loadAccountWalletIdInTx, attachAccountWalletInTx } from "@/lib/custodial-wallet/read";
export type AppAccountWithWallet = Prisma.AppAccountGetPayload<{
  include: { accountWallet: true };
}>;
export type CustodialProvisionErrorCode =
  | "encryption_key_missing"
  | "not_native_agent"
  | "agent_not_found";
export function describeCustodialProvisionError(code: CustodialProvisionErrorCode): string {
  switch (code) {
    case "encryption_key_missing":
      return "Set CUSTODIAL_WALLET_ENCRYPTION_KEY in the server environment (openssl rand -base64 32).";
    case "not_native_agent":
      return "Only AgentRanking native agents receive generated agent wallets.";
    case "agent_not_found":
      return "Agent not found.";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
function isEncryptionKeyConfigured(): boolean {
  const raw = process.env.CUSTODIAL_WALLET_ENCRYPTION_KEY?.trim();
  if (!raw) return false;
  try {
    return Buffer.from(raw, "base64").length === 32;
  } catch {
    return false;
  }
}
export function getCustodialProvisionBlocker():
  | { ok: true }
  | { ok: false; code: CustodialProvisionErrorCode } {
  if (!isEncryptionKeyConfigured()) {
    return { ok: false, code: "encryption_key_missing" };
  }
  return { ok: true };
}
async function attachAccountWallet(
  tx: Prisma.TransactionClient,
  accountId: string,
  actorProfileId: number,
): Promise<Prisma.CustodialWalletGetPayload<{ select: { id: true; publicKey: true } }>> {
  const wallet = await provisionCustodialSolanaWallet(tx, {
    scope: "ACCOUNT",
    actorProfileId,
  });
  await attachAccountWalletInTx(tx, accountId, wallet.id);
  return wallet;
}
export async function ensureAppAccountWallet(
  accountId: string,
  actorProfileId: number,
): Promise<string | null> {
  const blocker = getCustodialProvisionBlocker();
  if (!blocker.ok) return null;
  const account = await prisma.appAccount.findUnique({
    where: { id: accountId },
    include: { accountWallet: true },
  });
  if (!account) return null;
  if (account.accountWallet?.publicKey) return account.accountWallet.publicKey;
  const wallet = await prisma.$transaction(async (tx) => {
    const lockedWalletId = await loadAccountWalletIdInTx(tx, accountId);
    if (lockedWalletId) {
      const publicKey = await loadCustodialPublicKeyByWalletId(lockedWalletId);
      if (publicKey) return { id: lockedWalletId, publicKey };
    }
    return attachAccountWallet(tx, accountId, actorProfileId);
  });
  return wallet.publicKey;
}
async function upsertAgentWalletMetadata(
  tx: Prisma.TransactionClient,
  agentDbId: number,
  publicKey: string,
): Promise<void> {
  const safe = sanitizeForPostgres(publicKey);
  const existing = await tx.agentMetadata.findFirst({
    where: { agentId: agentDbId, key: "agentWallet" },
    select: { id: true },
  });
  if (existing) {
    await tx.agentMetadata.update({ where: { id: existing.id }, data: { value: safe } });
    return;
  }
  await tx.agentMetadata.create({
    data: { agentId: agentDbId, key: "agentWallet", value: safe },
  });
}
export async function ensureAgentCustodialWallet(
  agentDbId: number,
  actorProfileId: number,
): Promise<string | null> {
  const blocker = getCustodialProvisionBlocker();
  if (!blocker.ok) return null;
  const existing = await loadAgentCustodialWalletPublicKey(agentDbId);
  if (existing) return existing;
  const agent = await loadAgentWalletProvisionRow(agentDbId);
  if (!agent) return null;
  if (
    !isAgentRankingNativeAgent({
      listingRegistrySource: agent.listing_registry_source,
      chainId: agent.chainId,
    })
  ) {
    return null;
  }
  const wallet = await prisma.$transaction(async (tx) => {
    const lockedWalletId = await loadAgentWalletIdInTx(tx, agentDbId);
    if (lockedWalletId) {
      const publicKey = await loadCustodialPublicKeyByWalletId(lockedWalletId);
      if (publicKey) return { id: lockedWalletId, publicKey, scope: "AGENT" as const };
    }
    const created = await provisionCustodialSolanaWallet(tx, {
      scope: "AGENT",
      actorProfileId,
    });
    await attachAgentWalletInTx(tx, agentDbId, created.id, created.publicKey);
    await upsertAgentWalletMetadata(tx, agentDbId, created.publicKey);
    return created;
  });
  return wallet.publicKey;
}
export async function ensureAppAccountForProfile(profile: {
  id: number;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}): Promise<AppAccountWithWallet> {
  const existing = await prisma.appAccount.findUnique({
    where: { userProfileId: profile.id },
    include: { accountWallet: true },
  });
  if (existing?.accountWallet?.publicKey) {
    // Mark onboarding completed for existing accounts if not already set
    if (!existing.onboardingCompletedAt) {
      const hasAgents = await prisma.agent.count({
        where: { ownerAccountId: existing.id, isActive: true },
      });
      if (hasAgents > 0) {
        await prisma.appAccount.update({
          where: { id: existing.id },
          data: { onboardingCompletedAt: new Date() },
        });
      }
    }
    return existing;
  }
  if (existing && !existing.accountWalletId) {
    const blocker = getCustodialProvisionBlocker();
    if (blocker.ok) {
      await prisma.$transaction(async (tx) => {
        const lockedWalletId = await loadAccountWalletIdInTx(tx, existing.id);
        if (lockedWalletId) return;
        await attachAccountWallet(tx, existing.id, profile.id);
      });
      const refreshed = await prisma.appAccount.findUnique({
        where: { userProfileId: profile.id },
        include: { accountWallet: true },
      });
      if (refreshed) return refreshed;
    }
    return existing;
  }
  if (existing) return existing;
  const maxAgents = readMaxAgentsForAccount();
  const platformCredits = readDefaultAccountCredits("PLATFORM_CREDITS_DEFAULT_BALANCE");
  const llmBalanceCents = readDefaultAccountCredits("LLM_CREDITS_DEFAULT_BALANCE");
  return prisma.$transaction(async (tx) => {
    const account = await tx.appAccount.upsert({
      where: { userProfileId: profile.id },
      create: {
        userProfileId: profile.id,
        publicId: generateAccountPublicId(),
        displayName: profile.displayName?.trim() || null,
        email: profile.email?.trim() || null,
        imageUrl: profile.avatarUrl?.trim() || null,
        maxAgents,
        platformCredits,
        llmBalanceCents,
      },
      update: {},
      include: { accountWallet: true },
    });
    if (account.accountWallet?.publicKey) return account;
    const linkedWalletId = await loadAccountWalletIdInTx(tx, account.id);
    if (!linkedWalletId) {
      await attachAccountWallet(tx, account.id, profile.id);
      const ledgerRows: Array<{
        appAccountId: string;
        creditType: "PLATFORM" | "LLM";
        delta: number;
        balanceAfter: number;
        reason: string;
      }> = [];
      if (platformCredits > 0) {
        ledgerRows.push({
          appAccountId: account.id,
          creditType: "PLATFORM",
          delta: platformCredits,
          balanceAfter: platformCredits,
          reason: "bootstrap_default",
        });
      }
      if (llmBalanceCents > 0) {
        ledgerRows.push({
          appAccountId: account.id,
          creditType: "LLM",
          delta: llmBalanceCents,
          balanceAfter: llmBalanceCents,
          reason: "bootstrap_default",
        });
      }
      if (ledgerRows.length > 0) {
        await tx.accountCreditLedger.createMany({ data: ledgerRows });
      }
    }
    return tx.appAccount.findUniqueOrThrow({
      where: { id: account.id },
      include: { accountWallet: true },
    });
  });
}
