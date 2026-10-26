import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { resolveVerificationFeeSol, resolveVerificationTreasury } from "@/lib/agent-verification/config";
import { sendSolForVerification } from "@/lib/custodial-wallet/send-sol";
import { parseAgentLaunchNetwork } from "@/lib/agent-launch/network";
import { getAgentLaunchSolBalanceLamports } from "@/lib/agent-launch/solana";
import {
  buildAgentVerifiedFeedEvent,
  buildTokenVerifiedFeedEvent,
} from "@/lib/public-site/ar-live-feed-builders.server";
import { publishArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-publish.server";
const LAMPORTS_PER_SOL = 1_000_000_000;
export type VerificationEligibility = {
  eligible: boolean;
  reason: string;
  checks: VerificationCheck[];
};
export type VerificationCheck = {
  label: string;
  passed: boolean;
};
export type VerifyAgentInput = {
  agentDbId: number;
  userProfileId: number;
};
export type VerifyAgentResult =
  | { status: "verified"; signature: string; feeLamports: bigint; feeSol: number; recipient: string; tokenVerified: boolean }
  | { status: "already_verified" }
  | { status: "not_eligible"; reason: string; checks: VerificationCheck[] }
  | { status: "wallet_unavailable"; message: string }
  | { status: "insufficient_balance"; message: string }
  | { status: "payment_failed"; message: string }
  | { status: "error"; message: string };
export async function checkAgentVerificationEligibility(agentDbId: number): Promise<VerificationEligibility> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      isActive: true,
      name: true,
      image: true,
      arVerificationStatus: true,
      agentWalletId: true,
    },
  });
  const checks: VerificationCheck[] = [];
  if (!agent?.isActive) {
    return { eligible: false, reason: "Agent not found or inactive.", checks };
  }
  if (agent.arVerificationStatus === "verified") {
    checks.push({ label: "Agent exists and is active", passed: true });
    return { eligible: false, reason: "Agent is already verified.", checks };
  }
  checks.push({ label: "Agent exists and is active", passed: true });
  checks.push({ label: "Agent has a name", passed: Boolean(agent.name?.trim()) });
  checks.push({ label: "Agent has a profile image", passed: Boolean(agent.image?.trim()) });
  checks.push({ label: "Agent wallet exists", passed: Boolean(agent.agentWalletId) });
  const [officialLinkCount, metadataLinkCount] = await Promise.all([
    prisma.agentOfficialLink.count({ where: { agentId: agentDbId } }),
    prisma.agentMetadata.count({
      where: {
        agentId: agentDbId,
        key: { in: ["twitterUrl", "websiteUrl", "telegramUrl", "githubUrl"] },
      },
    }),
  ]);
  const hasLinks = officialLinkCount > 0 || metadataLinkCount > 0;
  checks.push({ label: "At least one official link", passed: hasLinks });
  const eligible = checks.every((c) => c.passed);
  if (!eligible) {
    const failedLabels = checks.filter((c) => !c.passed).map((c) => c.label).join(", ");
    return { eligible: false, reason: `Missing: ${failedLabels}`, checks };
  }
  return { eligible: true, reason: "Ready for verification.", checks };
}
export async function getVerificationState(agentDbId: number) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      name: true,
      image: true,
      arVerificationStatus: true,
      arVerifiedAt: true,
      arVerificationTxSignature: true,
      arVerificationFeeLamports: true,
      arVerificationWallet: true,
      arVerificationRecipient: true,
      agentWalletId: true,
    },
  });
  if (!agent) return null;
  const feeSol = resolveVerificationFeeSol();
  const treasury = resolveVerificationTreasury();
  // Load agent wallet info for the payment readiness card
  let agentWalletPublicKey: string | null = null;
  let agentWalletBalanceSol: number | null = null;
  if (agent.agentWalletId) {
    const wallet = await prisma.custodialWallet.findUnique({
      where: { id: agent.agentWalletId },
      select: { publicKey: true },
    });
    agentWalletPublicKey = wallet?.publicKey ?? null;
    if (agentWalletPublicKey) {
      try {
        const balanceLamports = await getAgentLaunchSolBalanceLamports(
          new PublicKey(agentWalletPublicKey),
        );
        agentWalletBalanceSol = balanceLamports / LAMPORTS_PER_SOL;
      } catch {
        agentWalletBalanceSol = null;
      }
    }
  }
  const launch = await prisma.agentLaunch.findFirst({
    where: { agentDbId, network: parseAgentLaunchNetwork(process.env.AGENT_LAUNCH_NETWORK) },
    select: {
      id: true,
      tokenName: true,
      tokenSymbol: true,
      mint: true,
      launchStatus: true,
      arTokenVerificationStatus: true,
      arTokenVerifiedAt: true,
      arTokenVerificationSource: true,
    },
  });
  const eligibility = await checkAgentVerificationEligibility(agentDbId);
  return {
    agentId: agent.id,
    agentName: agent.name,
    agentImage: agent.image,
    verificationStatus: agent.arVerificationStatus,
    verifiedAt: agent.arVerifiedAt?.toISOString() ?? null,
    verificationTxSignature: agent.arVerificationTxSignature,
    verificationFeeLamports: agent.arVerificationFeeLamports ? Number(agent.arVerificationFeeLamports) : null,
    verificationFeeSol: agent.arVerificationFeeLamports
      ? Number(agent.arVerificationFeeLamports) / LAMPORTS_PER_SOL
      : null,
    verificationWallet: agent.arVerificationWallet,
    verificationRecipient: agent.arVerificationRecipient,
    feeSol,
    feeLamports: Math.round(feeSol * LAMPORTS_PER_SOL),
    treasuryWallet: treasury || null,
    treasuryConfigured: Boolean(treasury),
    agentWalletPublicKey,
    agentWalletBalanceSol,
    eligible: eligibility.eligible,
    eligibilityReason: eligibility.reason,
    eligibilityChecks: eligibility.checks,
    token: launch
      ? {
          launchId: launch.id,
          tokenName: launch.tokenName,
          tokenSymbol: launch.tokenSymbol,
          mint: launch.mint,
          launchStatus: launch.launchStatus,
          verificationStatus: launch.arTokenVerificationStatus,
          verifiedAt: launch.arTokenVerifiedAt?.toISOString() ?? null,
          verificationSource: launch.arTokenVerificationSource,
        }
      : null,
    tokenExists: Boolean(launch?.mint),
    tokenLaunched: launch?.launchStatus === "launched",
    tokenVerificationEnabled: Boolean(launch?.launchStatus === "launched" && launch.mint),
  };
}
export async function verifyAgent(input: VerifyAgentInput): Promise<VerifyAgentResult> {
  const { agentDbId } = input;
  const eligibility = await checkAgentVerificationEligibility(agentDbId);
  if (!eligibility.eligible) {
    return { status: "not_eligible", reason: eligibility.reason, checks: eligibility.checks };
  }
  const feeSol = resolveVerificationFeeSol();
  const treasury = resolveVerificationTreasury();
  if (!treasury) {
    return {
      status: "error",
      message: "Verification treasury wallet is not configured. Set AGENT_VERIFICATION_TREASURY_WALLET.",
    };
  }
  // Mark as pending before payment
  await prisma.agent.update({
    where: { id: agentDbId },
    data: { arVerificationStatus: "pending" },
  });
  // Pay from this agent's custodial wallet — the user-facing wallet they fund and manage.
  const sendResult = await sendSolForVerification({
    agentDbId,
    recipient: treasury,
    amountSol: feeSol,
  });
  if (sendResult.status === "insufficient_balance") {
    await prisma.agent.update({
      where: { id: agentDbId },
      data: { arVerificationStatus: "unverified" },
    });
    return {
      status: "insufficient_balance",
      message: `Insufficient agent wallet balance. ${sendResult.message}`,
    };
  }
  if (sendResult.status === "wallet_unavailable") {
    await prisma.agent.update({
      where: { id: agentDbId },
      data: { arVerificationStatus: "unverified" },
    });
    return {
      status: "wallet_unavailable",
      message: `Agent wallet unavailable. ${sendResult.message}`,
    };
  }
  if (sendResult.status !== "sent") {
    await prisma.agent.update({
      where: { id: agentDbId },
      data: { arVerificationStatus: "failed" },
    });
    return { status: "payment_failed", message: sendResult.message };
  }
  const feeLamports = sendResult.amountLamports;
  // Mark as verified
  const verifiedAgent = await prisma.agent.update({
    where: { id: agentDbId },
    data: {
      arVerificationStatus: "verified",
      arVerifiedAt: new Date(),
      arVerificationTxSignature: sendResult.signature,
      arVerificationFeeLamports: feeLamports,
      arVerificationWallet: sendResult.fromPublicKey,
      arVerificationRecipient: treasury,
    },
    select: { id: true, agentId: true, chainId: true, name: true, arVerifiedAt: true },
  });
  publishArLiveFeedEvent(
    buildAgentVerifiedFeedEvent({
      agentDbId: verifiedAgent.id,
      chainId: verifiedAgent.chainId,
      agentId: verifiedAgent.agentId,
      name: verifiedAgent.name,
      verifiedAt: verifiedAgent.arVerifiedAt,
    }),
  );
  // Auto-verify linked token
  let tokenVerified = false;
  const launchedToken = await prisma.agentLaunch.findFirst({
    where: {
      agentDbId,
      network: parseAgentLaunchNetwork(process.env.AGENT_LAUNCH_NETWORK),
      launchStatus: { in: ["launched", "indexed"] },
      mint: { not: null },
    },
    select: {
      id: true,
      mint: true,
      tokenSymbol: true,
      tokenName: true,
      profileDisplayName: true,
    },
  });
  if (launchedToken?.mint) {
    const verifiedToken = await prisma.agentLaunch.update({
      where: { id: launchedToken.id },
      data: {
        arTokenVerificationStatus: "verified",
        arTokenVerifiedAt: new Date(),
        arTokenVerificationSource: "agent_verification",
      },
      select: { id: true, mint: true, arTokenVerifiedAt: true },
    });
    tokenVerified = true;
    publishArLiveFeedEvent(
      buildTokenVerifiedFeedEvent({
        launchId: verifiedToken.id,
        mint: launchedToken.mint,
        tokenSymbol: launchedToken.tokenSymbol,
        tokenName: launchedToken.profileDisplayName ?? launchedToken.tokenName,
        verifiedAt: verifiedToken.arTokenVerifiedAt,
      }),
    );
  }
  return {
    status: "verified",
    signature: sendResult.signature,
    feeLamports,
    feeSol: Number(feeLamports) / LAMPORTS_PER_SOL,
    recipient: treasury,
    tokenVerified,
  };
}
