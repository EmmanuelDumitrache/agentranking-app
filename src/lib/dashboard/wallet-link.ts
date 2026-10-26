import type { Prisma } from "@/generated/prisma/client";
import { getAddress, isAddress, verifyMessage } from "viem";
import { prisma } from "@/lib/db";
import {
  buildOwnedAgentsWhere,
} from "@/lib/dashboard/agent-ownership";
import { subscriptionPatchFromDonor } from "@/lib/merge-dashboard-wallet";
import { isSyntheticWalletEmail } from "@/lib/dashboard/auth-users";
import { normalizeSolanaAddress } from "@/lib/sap-claim-message";
import { verifySolanaSignMessage } from "@/lib/sap-claim-verify";
import {
  isFreshSolanaSignInTimestamp,
  parseSolanaSignInIssuedAt,
} from "@/lib/solana-auth-sign-in-server";
import {
  EVM_DASHBOARD_LINK_PREFIX,
  SOLANA_DASHBOARD_LINK_PREFIX,
} from "@/lib/dashboard/wallet-link-messages";
const LINK_FRESHNESS_MS = 20 * 60 * 1000;
export type WalletLinkSummary = {
  ownedCount: number;
  verifiedCount: number;
  premiumVerifiedCount: number;
  agents: Array<{
    id: number;
    name: string;
    isVerified: boolean;
    isPremiumVerified: boolean;
  }>;
};
function parseEvmLinkIssuedAt(message: string): number | null {
  const issued = message.match(/Issued At:\s*(.+)/i)?.[1]?.trim();
  if (!issued) return null;
  const t = Date.parse(issued);
  return Number.isFinite(t) ? t : null;
}
function isFreshLinkTimestamp(issuedMs: number, nowMs: number = Date.now()): boolean {
  return Math.abs(nowMs - issuedMs) <= LINK_FRESHNESS_MS;
}
export function verifyEvmDashboardLinkMessage(
  address: string,
  message: string,
  _signature: string,
): { ok: true; wallet: string } | { ok: false; error: string } {
  if (!isAddress(address)) {
    return { ok: false, error: "Invalid wallet address." };
  }
  if (!message.startsWith(EVM_DASHBOARD_LINK_PREFIX)) {
    return { ok: false, error: "Invalid link message format." };
  }
  const walletInMessage = message
    .slice(EVM_DASHBOARD_LINK_PREFIX.length, message.indexOf("\nIssued At:"))
    .trim();
  const checksummed = getAddress(address);
  if (walletInMessage.toLowerCase() !== checksummed.toLowerCase()) {
    return { ok: false, error: "Message wallet does not match address." };
  }
  const issuedMs = parseEvmLinkIssuedAt(message);
  if (issuedMs == null || !isFreshLinkTimestamp(issuedMs)) {
    return { ok: false, error: "Link message expired. Try again." };
  }
  return { ok: true, wallet: checksummed.toLowerCase() };
}
export async function verifyEvmDashboardLinkSignature(
  address: string,
  message: string,
  signature: string,
): Promise<{ ok: true; wallet: string } | { ok: false; error: string }> {
  const parsed = verifyEvmDashboardLinkMessage(address, message, signature);
  if (!parsed.ok) return parsed;
  try {
    const checksummed = getAddress(address);
    const valid = await verifyMessage({
      address: checksummed,
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) return { ok: false, error: "Signature verification failed." };
    return { ok: true, wallet: parsed.wallet };
  } catch {
    return { ok: false, error: "Signature verification failed." };
  }
}
export function verifySolanaDashboardLinkMessage(
  publicKey: string,
  message: string,
  signature: string,
): { ok: true; wallet: string } | { ok: false; error: string } {
  const norm = normalizeSolanaAddress(publicKey);
  if (!norm) return { ok: false, error: "Invalid Solana public key." };
  if (!message.startsWith(SOLANA_DASHBOARD_LINK_PREFIX)) {
    return { ok: false, error: "Invalid link message format." };
  }
  const walletInMessage = message
    .slice(SOLANA_DASHBOARD_LINK_PREFIX.length, message.indexOf("\nIssued At:"))
    .trim();
  if (walletInMessage !== norm) {
    return { ok: false, error: "Message wallet does not match public key." };
  }
  const issuedMs = parseSolanaSignInIssuedAt(message);
  if (issuedMs == null || !isFreshSolanaSignInTimestamp(issuedMs, Date.now(), LINK_FRESHNESS_MS)) {
    return { ok: false, error: "Link message expired. Try again." };
  }
  if (!verifySolanaSignMessage(message, signature, norm)) {
    return { ok: false, error: "Signature verification failed." };
  }
  return { ok: true, wallet: norm };
}
const donorSelect = {
  id: true,
  email: true,
  displayName: true,
  walletAddress: true,
  solanaWallet: true,
  subscriptionStatus: true,
  subscriptionPlan: true,
  subscriptionExpiresAt: true,
  subscriptionStartedAt: true,
  helioSubscriptionId: true,
} as const;
export async function getWalletLinkSummary(profileId: number): Promise<WalletLinkSummary> {
  const profile = await prisma.userProfile.findUnique({
    where: { id: profileId },
    select: { id: true, walletAddress: true, solanaWallet: true },
  });
  if (!profile) {
    return { ownedCount: 0, verifiedCount: 0, premiumVerifiedCount: 0, agents: [] };
  }
  const agents = await prisma.agent.findMany({
    where: buildOwnedAgentsWhere(profile),
    select: {
      id: true,
      name: true,
      isVerified: true,
      isPremiumVerified: true,
    },
    orderBy: [{ isPremiumVerified: "desc" }, { isVerified: "desc" }, { name: "asc" }],
    take: 20,
  });
  const verified = agents.filter((agent) => agent.isPremiumVerified || agent.isVerified);
  return {
    ownedCount: agents.length,
    verifiedCount: verified.length,
    premiumVerifiedCount: agents.filter((a) => a.isPremiumVerified).length,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      isVerified: a.isVerified,
      isPremiumVerified: a.isPremiumVerified,
    })),
  };
}
async function mergeEvmDonorWallet(primaryId: number, walletNorm: string) {
  const primaryRow = await prisma.userProfile.findUnique({
    where: { id: primaryId },
    select: donorSelect,
  });
  if (!primaryRow) throw new Error("PROFILE_GONE");
  const donor = await prisma.userProfile.findFirst({
    where: {
      walletAddress: { equals: walletNorm, mode: "insensitive" },
      NOT: { id: primaryId },
    },
    select: donorSelect,
  });
  if (!donor) {
    await prisma.userProfile.update({
      where: { id: primaryId },
      data: { walletAddress: walletNorm, solanaWallet: null },
    });
    return;
  }
  const donorEmail = donor.email?.trim().toLowerCase() ?? null;
  const primaryEmail = primaryRow.email?.trim().toLowerCase() ?? null;
  if (donorEmail && primaryEmail && donorEmail !== primaryEmail) {
    const err = new Error("WALLET_CONFLICT");
    throw err;
  }
  const subPatch = subscriptionPatchFromDonor(primaryRow, donor);
  const displayFill: Prisma.UserProfileUpdateInput =
    !primaryRow.displayName?.trim() && donor.displayName?.trim()
      ? { displayName: donor.displayName }
      : {};
  await prisma.$transaction([
    prisma.userProfile.update({
      where: { id: donor.id },
      data: { walletAddress: null },
    }),
    prisma.userProfile.update({
      where: { id: primaryId },
      data: {
        ...displayFill,
        walletAddress: walletNorm,
        solanaWallet: null,
        ...subPatch,
      },
    }),
  ]);
}
async function mergeSolanaDonorWallet(primaryId: number, solNorm: string) {
  const primaryRow = await prisma.userProfile.findUnique({
    where: { id: primaryId },
    select: donorSelect,
  });
  if (!primaryRow) throw new Error("PROFILE_GONE");
  const donor = await prisma.userProfile.findFirst({
    where: {
      solanaWallet: solNorm,
      NOT: { id: primaryId },
    },
    select: donorSelect,
  });
  if (!donor) {
    await prisma.userProfile.update({
      where: { id: primaryId },
      data: { solanaWallet: solNorm, walletAddress: null },
    });
    return;
  }
  const donorEmail = donor.email?.trim().toLowerCase() ?? null;
  const primaryEmail = primaryRow.email?.trim().toLowerCase() ?? null;
  if (donorEmail && primaryEmail && donorEmail !== primaryEmail) {
    throw new Error("WALLET_CONFLICT");
  }
  await prisma.$transaction([
    prisma.userProfile.update({
      where: { id: donor.id },
      data: { solanaWallet: null },
    }),
    prisma.userProfile.update({
      where: { id: primaryId },
      data: { solanaWallet: solNorm, walletAddress: null },
    }),
  ]);
}
export async function linkEvmWalletToProfile(
  profileId: number,
  address: string,
  message: string,
  signature: string,
): Promise<WalletLinkSummary> {
  const verified = await verifyEvmDashboardLinkSignature(address, message, signature);
  if (!verified.ok) throw new Error(verified.error);
  try {
    await mergeEvmDonorWallet(profileId, verified.wallet);
  } catch (e) {
    if (Error.isError(e) && e.message === "WALLET_CONFLICT") {
      const err = new Error(
        "This wallet is already linked to a different email account. Contact support if you need accounts merged.",
      );
      (err as Error & { code: string }).code = "WALLET_CONFLICT";
      throw err;
    }
    throw e;
  }
  return getWalletLinkSummary(profileId);
}
export async function linkSolanaWalletToProfile(
  profileId: number,
  publicKey: string,
  message: string,
  signature: string,
): Promise<WalletLinkSummary> {
  const verified = verifySolanaDashboardLinkMessage(publicKey, message, signature);
  if (!verified.ok) throw new Error(verified.error);
  const me = await prisma.userProfile.findUnique({
    where: { id: profileId },
    select: { solanaWallet: true },
  });
  const existingSol = me?.solanaWallet?.trim();
  if (existingSol && existingSol !== verified.wallet) {
    const err = new Error("Your account already has a different Solana wallet linked.");
    (err as Error & { code: string }).code = "SOL_CONFLICT";
    throw err;
  }
  const taken = await prisma.userProfile.findFirst({
    where: { solanaWallet: verified.wallet, NOT: { id: profileId } },
    select: { id: true, email: true },
  });
  if (taken) {
    const err = new Error("This Solana wallet is linked to another AgentRanking account.");
    (err as Error & { code: string }).code = "WALLET_CONFLICT";
    throw err;
  }
  await mergeSolanaDonorWallet(profileId, verified.wallet);
  return getWalletLinkSummary(profileId);
}
export async function unlinkWalletFromProfile(
  profileId: number,
  chain: "evm" | "solana",
): Promise<WalletLinkSummary> {
  const profile = await prisma.userProfile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      email: true,
      walletAddress: true,
      solanaWallet: true,
    },
  });
  if (!profile) throw new Error("Profile not found.");
  const hasRealEmail = Boolean(profile.email?.trim() && !isSyntheticWalletEmail(profile.email));
  const wouldOrphan =
    !hasRealEmail &&
    ((chain === "evm" && !profile.solanaWallet?.trim()) ||
      (chain === "solana" && !profile.walletAddress?.trim()));
  if (wouldOrphan) {
    const err = new Error(
      "Cannot unlink your only wallet without a verified email on this account. Add an email first or sign out.",
    );
    (err as Error & { code: string }).code = "ORPHAN_ACCOUNT";
    throw err;
  }
  if (chain === "evm") {
    await prisma.userProfile.update({
      where: { id: profileId },
      data: { walletAddress: null },
    });
  } else {
    await prisma.userProfile.update({
      where: { id: profileId },
      data: { solanaWallet: null },
    });
  }
  return getWalletLinkSummary(profileId);
}
