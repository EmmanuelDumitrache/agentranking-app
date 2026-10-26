import type { Prisma } from "@/generated/prisma/client";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { prisma } from "@/lib/db";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
import { withInheritedAgentVerification } from "@/lib/public-site/agent-verification";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import {
  getAgentLaunchSolBalanceLamports,
  withAgentLaunchReadRpc,
} from "@/lib/agent-launch/solana";
import { ensureAgentCustodialWallet } from "@/lib/custodial-wallet/bootstrap";
import { resolveAgentWallet } from "@/lib/custodial-wallet/agent-wallet-resolve";
import { loadAgentCustodialWalletPublicKey } from "@/lib/custodial-wallet/read";
import { solscanAccountUrlForNetwork } from "@/lib/custodial-wallet/solscan";
import { AR_SOLANA_MINT } from "@/lib/ar-token-public";
import { getLatestRobinhoodLaunchForAgent } from "@/lib/robinhood-chain/record-launch.server";
import { INFERENCE_PROVIDER_IDS_METADATA_KEY } from "@/lib/inference-providers/constants";
import { getInferenceProviderById, isKnownInferenceProviderId } from "@/lib/inference-providers/registry";
import { isAgentSolanaDirectoryListed } from "@/lib/agent-solana-registration/display";
/** Canonical USDC SPL mint on Solana mainnet. */
const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/**
 * Fetch the SPL token balance (in base units / lamports) for a given mint+owner.
 * Handles both original SPL Token and Token-2022 mints automatically.
 * Returns null if the owner doesn't have a token account for this mint, or on error.
 */
async function loadSplTokenBalanceRaw(
  mintAddress: string,
  ownerAddress: string,
): Promise<bigint | null> {
  try {
    return await withAgentLaunchReadRpc(async (connection) => {
      const mint = new PublicKey(mintAddress);
      const owner = new PublicKey(ownerAddress);
      const mintInfo = await connection.getAccountInfo(mint, "confirmed");
      if (!mintInfo) return null;
      const programId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID;
      const ata = getAssociatedTokenAddressSync(mint, owner, true, programId);
      try {
        const balance = await connection.getTokenAccountBalance(ata, "confirmed");
        return BigInt(balance.value.amount);
      } catch {
        return BigInt(0);
      }
    });
  } catch {
    return null;
  }
}
export async function loadAgentWalletSolBalanceLamports(
  publicKey: string | null | undefined,
): Promise<number | null> {
  const trimmed = publicKey?.trim();
  if (!trimmed) return null;
  try {
    return await getAgentLaunchSolBalanceLamports(new PublicKey(trimmed));
  } catch {
    return null;
  }
}
/**
 * Fetch USDC SPL token balance for a wallet.
 * Returns the balance in raw base units (6 decimals), or null on error.
 */
export async function loadAgentWalletUsdcBalanceRaw(
  publicKey: string | null | undefined,
): Promise<bigint | null> {
  if (!publicKey?.trim()) return null;
  return loadSplTokenBalanceRaw(USDC_SOLANA_MINT, publicKey.trim());
}
/**
 * Fetch $AR SPL token balance for a wallet.
 * Returns the balance in raw base units (6 decimals), or null on error.
 */
export async function loadAgentWalletArBalanceRaw(
  publicKey: string | null | undefined,
): Promise<bigint | null> {
  if (!publicKey?.trim()) return null;
  return loadSplTokenBalanceRaw(AR_SOLANA_MINT, publicKey.trim());
}
/** Sequential Solana wallet reads to avoid RPC rate-limit bursts on the dashboard. */
export async function loadAgentWalletDashboardBalances(
  publicKey: string | null | undefined,
): Promise<{
  solBalanceLamports: number | null;
  usdcBalanceRaw: bigint | null;
  arBalanceRaw: bigint | null;
}> {
  const trimmed = publicKey?.trim();
  if (!trimmed) {
    return { solBalanceLamports: null, usdcBalanceRaw: null, arBalanceRaw: null };
  }
  const solBalanceLamports = await loadAgentWalletSolBalanceLamports(trimmed);
  const usdcBalanceRaw = await loadAgentWalletUsdcBalanceRaw(trimmed);
  const arBalanceRaw = await loadAgentWalletArBalanceRaw(trimmed);
  return { solBalanceLamports, usdcBalanceRaw, arBalanceRaw };
}
const agentOverviewSelect = {
  id: true,
  createdAt: true,
  agentId: true,
  chainId: true,
  name: true,
  image: true,
  description: true,
  listingRegistrySource: true,
  isVerified: true,
  isPremiumVerified: true,
  publicVerificationStatus: true,
  arVerificationStatus: true,
  ownerAccount: {
    select: {
      verificationStatus: true,
      verificationExpiresAt: true,
    },
  },
  arVerifiedAt: true,
  arVerificationTxSignature: true,
  tokenAddress: true,
  solanaAssetAddress: true,
  solanaCanonicalStatus: true,
  metaplexAgentTokenMint: true,
  x402Support: true,
  owner: true,
  services: { select: { id: true }, take: 1 },
  paidServices: { where: { isPublished: true }, select: { id: true }, take: 1 },
  githubConnections: { select: { id: true, repoFullName: true, status: true }, take: 1 },
  metadata: {
    where: {
      key: {
        in: [
          "dashboardImportStatus",
          "website",
          "agentWallet",
          "twitter",
          "telegram",
          "github",
          "capability",
          INFERENCE_PROVIDER_IDS_METADATA_KEY,
        ],
      },
    },
    select: { key: true, value: true },
  },
} satisfies Prisma.AgentSelect;
export async function loadDashboardAgentOverview(
  agentDbId: number,
  options?: { actorProfileId?: number; autoProvisionWallet?: boolean },
) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: agentOverviewSelect,
  });
  if (!agent) return null;

  const inherited = withInheritedAgentVerification({
    arVerificationStatus: agent.arVerificationStatus,
    publicVerificationStatus: agent.publicVerificationStatus,
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified,
    ownerAccount: agent.ownerAccount,
  });
  const agentWithVerification = {
    ...agent,
    arVerificationStatus: inherited.arVerificationStatus ?? agent.arVerificationStatus,
    isVerified: inherited.isVerified,
    isPremiumVerified: inherited.isPremiumVerified,
  };

  const launchConfig = getAgentLaunchConfig();
  const isNative = isAgentRankingNativeAgent(agentWithVerification);
  const network = launchConfig.network;
  const launch = await prisma.agentLaunch.findFirst({
    where: {
      network,
      OR: [
        { agentId: String(agentDbId) },
        ...(agent.metaplexAgentTokenMint ? [{ mint: agent.metaplexAgentTokenMint }] : []),
        ...(agent.tokenAddress ? [{ mint: agent.tokenAddress }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      mint: true,
      launchStatus: true,
      launchLifecycleStatus: true,
      tokenName: true,
      tokenSymbol: true,
      network: true,
    },
  });
  const robinhoodLaunch = await getLatestRobinhoodLaunchForAgent(agentDbId);
  const importStatus =
    agent.metadata.find((row) => row.key === "dashboardImportStatus")?.value ?? null;
  const metadataValue = (key: string) =>
    agent.metadata.find((row) => row.key === key)?.value?.trim() || null;
  const capabilities = agent.metadata
    .filter((row) => row.key === "capability")
    .map((row) => row.value.trim())
    .filter(Boolean);
  const inferenceProviderIds = (() => {
    const raw = metadataValue(INFERENCE_PROVIDER_IDS_METADATA_KEY);
    if (!raw) return [] as string[];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return [...new Set(parsed
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter(isKnownInferenceProviderId))];
    } catch {
      return [];
    }
  })();
  const primaryInferenceProvider = inferenceProviderIds[0]
    ? getInferenceProviderById(inferenceProviderIds[0])
    : undefined;
  let custodialPublicKey = await loadAgentCustodialWalletPublicKey(agentDbId);
  if (
    !custodialPublicKey &&
    isNative &&
    options?.autoProvisionWallet !== false &&
    options?.actorProfileId != null
  ) {
    custodialPublicKey = await ensureAgentCustodialWallet(agentDbId, options.actorProfileId);
  }
  const metadataWallet = metadataValue("agentWallet");
  const resolvedWallet = await resolveAgentWallet(agentDbId, {
    owner: agent.owner,
    listingRegistrySource: agent.listingRegistrySource,
    chainId: agent.chainId,
    metadataWallet,
  });
  const agentWalletPublicKey = resolvedWallet?.publicKey ?? null;
  const agentWalletSolscanUrl = agentWalletPublicKey
    ? solscanAccountUrlForNetwork(agentWalletPublicKey, launchConfig.network)
    : null;
  return {
    agent: agentWithVerification,
    sourceLabel: isAgentRankingNativeAgent(agent)
      ? "AgentRanking native"
      : agent.listingRegistrySource === "default"
        ? "Global indexed"
        : agent.listingRegistrySource,
    agentWalletPublicKey,
    agentWalletSolscanUrl,
    agentWalletIsCustodial: resolvedWallet?.isCustodial ?? false,
    agentWalletProvisioned: Boolean(agentWalletPublicKey),
    solanaNetwork: launchConfig.network,
    tokenStatus: launch
      ? {
          state: launch.launchStatus,
          lifecycle: launch.launchLifecycleStatus,
          mint: launch.mint,
          symbol: launch.tokenSymbol,
          name: launch.tokenName,
          network: launch.network,
          chain: "solana" as const,
        }
      : robinhoodLaunch
        ? {
            state: "live" as const,
            lifecycle: "live" as const,
            mint: robinhoodLaunch.tokenAddress,
            symbol: robinhoodLaunch.tokenSymbol,
            name: robinhoodLaunch.tokenName,
            network: "robinhood",
            chain: "robinhood" as const,
            poolAddress: robinhoodLaunch.poolAddress,
            txHash: robinhoodLaunch.txHash,
            sourceVerified: robinhoodLaunch.sourceVerified,
          }
        : agent.tokenAddress || agent.metaplexAgentTokenMint
          ? { state: "indexed", mint: agent.tokenAddress || agent.metaplexAgentTokenMint, chain: "solana" as const }
          : { state: "none" as const },
    robinhoodLaunch,
    verificationStatus: agent.publicVerificationStatus,
    githubStatus: agent.githubConnections[0]?.status ?? "not_connected",
    githubRepo: agent.githubConnections[0]?.repoFullName ?? null,
    hasServices: agent.services.length > 0 || agent.paidServices.length > 0,
    importStatus,
    capabilities,
    inferenceProviderIds,
    inferenceProviderName: primaryInferenceProvider?.name ?? null,
    website: metadataValue("website"),
    twitter: metadataValue("twitter"),
    telegram: metadataValue("telegram"),
    github: metadataValue("github"),
  };
}
export type DashboardAgentOverviewData = NonNullable<
  Awaited<ReturnType<typeof loadDashboardAgentOverview>>
>;
export type DashboardAgentOverviewDto = {
  agent: {
    id: number;
    agentId: number;
    chainId: number;
    name: string;
    image: string;
    description: string;
    arVerificationStatus: string;
    isSolanaRegistered: boolean;
  };
  tokenStatus:
    | { state: "none" }
    | {
        state: string;
        mint: string | null;
        chain: "solana" | "robinhood";
        symbol?: string | null;
      };
  agentWalletPublicKey: string | null;
  agentWalletSolscanUrl: string | null;
  agentWalletIsCustodial: boolean;
  capabilities: string[];
  solanaNetwork: string;
};
export function toDashboardAgentOverviewDto(
  data: DashboardAgentOverviewData,
): DashboardAgentOverviewDto {
  const tokenStatus: DashboardAgentOverviewDto["tokenStatus"] =
    data.tokenStatus.state === "none"
      ? { state: "none" }
      : {
          state: data.tokenStatus.state,
          mint: "mint" in data.tokenStatus ? data.tokenStatus.mint ?? null : null,
          chain:
            "chain" in data.tokenStatus && data.tokenStatus.chain === "robinhood"
              ? "robinhood"
              : "solana",
          ...(
            "symbol" in data.tokenStatus
              ? { symbol: data.tokenStatus.symbol ?? null }
              : {}
          ),
        };
  return {
    agent: {
      id: data.agent.id,
      agentId: data.agent.agentId,
      chainId: data.agent.chainId,
      name: data.agent.name,
      image: data.agent.image,
      description: data.agent.description,
      arVerificationStatus: data.agent.arVerificationStatus,
      isSolanaRegistered: isAgentSolanaDirectoryListed(data.agent),
    },
    tokenStatus,
    agentWalletPublicKey: data.agentWalletPublicKey,
    agentWalletSolscanUrl: data.agentWalletSolscanUrl,
    agentWalletIsCustodial: data.agentWalletIsCustodial,
    capabilities: [...data.capabilities],
    solanaNetwork: data.solanaNetwork,
  };
}