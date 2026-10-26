import type { Session } from "next-auth";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { getCustodialProvisionBlocker, describeCustodialProvisionError } from "@/lib/custodial-wallet/bootstrap";
import { readMaxAgentsForAccount } from "@/lib/custodial-wallet/config";
import { solscanAccountUrlForNetwork } from "@/lib/custodial-wallet/solscan";
import { isValidSolanaPublicKey } from "@/lib/custodial-wallet/validate";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { isAccountVerifiedStatus } from "@/lib/verification/account-verification-types";
export type AppAccountSummary = {
  accountId: string | null;
  profileId: number;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  /** Custodial account wallet public key (never exposes private key). */
  accountWalletPublicKey: string | null;
  accountWalletSource: "custodial" | "linked_solana" | "linked_evm" | "pending_custodial";
  accountWalletSolscanUrl: string | null;
  solanaNetwork: string;
  platformCredits: number;
  llmBalanceCents: number;
  /** Combined display balance (LLM + platform). */
  totalBalance: number;
  agentCount: number;
  maxAgents: number;
  /** Fresh account KYC status — agents inherit verified badge when true. */
  accountIsVerified: boolean;
  /** Public operator credential ID when KYC is active. */
  credentialPublicId: string | null;
  solBalanceLamports: number | null;
  /** Set when custodial provisioning is blocked by server configuration. */
  walletProvisionError: string | null;
};
async function loadAppAccountSummaryUncached(
  session: Session | null,
  options?: { solBalanceLamports?: number | null },
): Promise<AppAccountSummary | null> {
  if (!hasDashboardSessionIdentity(session)) return null;
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) return null;
  const access = await getDashboardAccess(session);
  const nativeAgentCount = access.ownedAgents.filter(isAgentRankingNativeAgent).length;
  const launchConfig = getAgentLaunchConfig();
  let accountId: string | null = null;
  let accountWalletPublicKey: string | null = null;
  let accountWalletSource: AppAccountSummary["accountWalletSource"] = "pending_custodial";
  let platformCredits = 0;
  let llmBalanceCents = 0;
  let maxAgents = readMaxAgentsForAccount();
  let solBalanceLamports = options?.solBalanceLamports ?? null;
  let walletProvisionError: string | null = null;
  const provisionBlocker = getCustodialProvisionBlocker();
  const appAccount = await prisma.appAccount.findUnique({
    where: { userProfileId: profile.id },
    select: {
      id: true,
      maxAgents: true,
      platformCredits: true,
      llmBalanceCents: true,
      cachedSolBalanceLamports: true,
      verificationStatus: true,
      verificationExpiresAt: true,
      publicId: true,
      accountWallet: { select: { publicKey: true } },
    },
  });
  if (!appAccount) {
    walletProvisionError = provisionBlocker.ok
      ? "Account setup is incomplete. Sign out and sign in again, or provision the account wallet explicitly."
      : describeCustodialProvisionError(provisionBlocker.code);
  } else {
    accountId = appAccount.id;
    maxAgents = appAccount.maxAgents;
    platformCredits = appAccount.platformCredits;
    llmBalanceCents = appAccount.llmBalanceCents;
    if (appAccount.accountWallet?.publicKey) {
      accountWalletPublicKey = appAccount.accountWallet.publicKey;
      accountWalletSource = "custodial";
    } else {
      walletProvisionError = provisionBlocker.ok
        ? "Account wallet has not been provisioned. Use the wallet setup action to create it."
        : describeCustodialProvisionError(provisionBlocker.code);
    }
    if (solBalanceLamports == null && appAccount.cachedSolBalanceLamports != null) {
      const cached = appAccount.cachedSolBalanceLamports;
      solBalanceLamports = cached <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cached) : null;
    }
  }
  if (!accountWalletPublicKey && walletProvisionError) {
    const solana = profile.solanaWallet?.trim() ?? "";
    const evm = profile.walletAddress?.trim() ?? "";
    if (isValidSolanaPublicKey(solana)) {
      accountWalletPublicKey = solana;
      accountWalletSource = "linked_solana";
    } else if (evm) {
      accountWalletPublicKey = evm;
      accountWalletSource = "linked_evm";
    }
  }
  const accountWalletSolscanUrl = accountWalletPublicKey
    ? solscanAccountUrlForNetwork(accountWalletPublicKey, launchConfig.network)
    : null;
  const accountIsVerified = appAccount
    ? isAccountVerifiedStatus(
        appAccount.verificationStatus,
        appAccount.verificationExpiresAt,
      )
    : false;
  const credentialPublicId =
    accountIsVerified && appAccount?.publicId?.trim()
      ? appAccount.publicId.trim()
      : null;
  return {
    accountId,
    profileId: profile.id,
    displayName: profile.displayName?.trim() || session?.user?.name?.trim() || "Account",
    avatarUrl: profile.avatarUrl?.trim() || session?.user?.image?.trim() || null,
    email: profile.email ?? session?.user?.email ?? null,
    accountWalletPublicKey,
    accountWalletSource,
    accountWalletSolscanUrl,
    solanaNetwork: launchConfig.network,
    platformCredits,
    llmBalanceCents,
    totalBalance: platformCredits + llmBalanceCents,
    agentCount: nativeAgentCount,
    maxAgents,
    accountIsVerified,
    credentialPublicId,
    solBalanceLamports,
    walletProvisionError,
  };
}
const loadAppAccountSummaryCached = cache((session: Session | null) =>
  loadAppAccountSummaryUncached(session),
);
export async function loadAppAccountSummary(
  session: Session | null,
  options?: { solBalanceLamports?: number | null },
): Promise<AppAccountSummary | null> {
  if (options && Object.hasOwn(options, "solBalanceLamports")) {
    return loadAppAccountSummaryUncached(session, options);
  }
  return loadAppAccountSummaryCached(session);
}
export async function countNativeAgentsForProfile(profileId: number): Promise<number> {
  const rows = await prisma.agent.findMany({
    where: {
      sapOperatorClaim: { userProfileId: profileId },
      listingRegistrySource: "agentranking",
      isActive: true,
    },
    select: { id: true, listingRegistrySource: true, chainId: true },
  });
  return rows.filter(isAgentRankingNativeAgent).length;
}
export function assertAgentCreationAllowed(agentCount: number, maxAgents: number): void {
  if (agentCount >= maxAgents) {
    throw new Error(`Agent limit reached (${maxAgents}). Upgrade or remove an agent to create more.`);
  }
}
export async function persistAccountSolBalance(
  accountId: string,
  lamports: number,
): Promise<void> {
  await prisma.appAccount.update({
    where: { id: accountId },
    data: {
      cachedSolBalanceLamports: BigInt(lamports),
      lastBalanceSyncAt: new Date(),
    },
  });
}
