import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { serializeAgentLaunch, serializeAgentLaunchDistribution } from "@/lib/agent-launch/serialize";
import { resolveLaunchDisplayProfile } from "@/lib/agent-launch/launch-profile";
import { parseStoredTokenMetadataJson } from "@/lib/agent-launch/metadata-display.server";
import { buildAgentRankingTokenDescription } from "@/lib/agent-launch/metadata-branding";
import { loadLaunchLinkedAgentSummary } from "@/lib/agent-launch/linked-agent";
import type { LaunchLinkedAgentSummary } from "@/lib/agent-launch/linked-agent";
import type { LaunchDisplayProfile } from "@/lib/agent-launch/launch-profile";
import { getDexscreenerMarketForMint } from "@/lib/public-site/dexscreener";
import { getPumpFunBondingData } from "@/lib/public-site/pumpfun-bonding";
import type { PumpFunBondingData } from "@/lib/public-site/pumpfun-bonding";
import { resolveMarketViewModel } from "@/lib/public-site/market-view-model";
import type { PublicTokenMarketViewModel } from "@/lib/public-site/market-view-model";
import { getOfficialPublicToken } from "@/lib/public-site/official-tokens";
import type { OfficialPublicToken } from "@/lib/public-site/official-tokens";
export type PublicTokenDetailData = {
  /** Distinguishes AgentRanking-launched tokens from curated official tokens. */
  kind: "launched" | "official";
  launch: ReturnType<typeof serializeAgentLaunch>;
  profile: LaunchDisplayProfile;
  linkedAgent: LaunchLinkedAgentSummary | null;
  distributions: ReturnType<typeof serializeAgentLaunchDistribution>[];
  totals: {
    totalFeesDistributedLamports: string;
    totalCreatorFeesLamports: string;
    totalArFeesLamports: string;
    lastDistributionAt: string | null;
  };
  networkLabel: string;
  isMainnet: boolean;
  isDevnet: boolean;
  /** Normalized market view model — the single source of truth for all market UI. */
  marketView: PublicTokenMarketViewModel;
  /** Live Pump.fun bonding data (null if not bonding-stage or unavailable). */
  pumpFun: PumpFunBondingData | null;
  /** Only present for official tokens. */
  official?: OfficialPublicToken;
};
export async function loadPublicTokenDetailData(mint: string): Promise<PublicTokenDetailData> {
  // Check if this mint belongs to an official curated token first
  const official = getOfficialPublicToken(mint);
  if (official) {
    return buildOfficialTokenDetailData(official);
  }
  // Standard AgentLaunch path
  const launch = await prisma.agentLaunch.findUnique({ where: { mint } });
  if (!launch) {
    notFound();
  }
  const network = launch.network?.trim().toLowerCase() ?? "devnet";
  const isMainnet = network === "mainnet-beta" || network === "mainnet";
  const [distributions, linkedAgent, market] = await Promise.all([
    prisma.agentLaunchFeeDistribution.findMany({
      where: { launchId: launch.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    loadLaunchLinkedAgentSummary(launch),
    launch.mint ? getDexscreenerMarketForMint(launch.mint) : Promise.resolve(null),
  ]);
  // Fetch Pump.fun bonding-curve data for all mainnet tokens (graduation + metadata)
  const pumpFun =
    isMainnet && launch.mint
      ? await getPumpFunBondingData(launch.mint)
      : null;
  const serialized = serializeAgentLaunch(launch);
  const storedMetadata = parseStoredTokenMetadataJson(launch.metadataJson);
  const brandedDescription =
    storedMetadata?.description?.trim() ||
    buildAgentRankingTokenDescription({
      userDescription:
        launch.profileLongDescription?.trim() ||
        launch.tokenDescription?.trim() ||
        "",
    });
  const profile = {
    ...resolveLaunchDisplayProfile(launch),
    shortDescription:
      launch.profileShortDescription?.trim() ||
      brandedDescription.split("\n\n")[0]?.slice(0, 280) ||
      null,
    longDescription: brandedDescription,
  };
  const marketView = resolveMarketViewModel({ isMainnet, mint: launch.mint, market, pumpFun });
  // Merge Pump.fun token-metadata socials into the profile.
  const selfUrl = launch.mint ? `https://agentranking.io/tokens/${launch.mint}` : null;
  const pumpWebsite = pumpFun?.website;
  const websiteUrl =
    pumpWebsite && pumpWebsite !== selfUrl && !pumpWebsite.includes("agentranking.io/tokens/")
      ? pumpWebsite
      : null;
  const mergedProfile: LaunchDisplayProfile = pumpFun
    ? {
        ...profile,
        website: websiteUrl || profile.website,
        twitter: pumpFun.twitter || profile.twitter,
        telegram: pumpFun.telegram || profile.telegram,
      }
    : profile;
  return {
    kind: "launched",
    launch: serialized,
    profile: mergedProfile,
    linkedAgent,
    distributions: distributions.map(serializeAgentLaunchDistribution),
    totals: {
      totalFeesDistributedLamports: serialized.totalFeesDistributedLamports,
      totalCreatorFeesLamports: serialized.totalCreatorFeesLamports,
      totalArFeesLamports: serialized.totalArFeesLamports,
      lastDistributionAt: serialized.lastDistributionAt,
    },
    networkLabel: isMainnet ? "Mainnet" : "Devnet",
    isMainnet,
    isDevnet: !isMainnet,
    marketView,
    pumpFun,
  };
}
/** Build a PublicTokenDetailData from a curated official token (no DB record). */
async function buildOfficialTokenDetailData(
  official: OfficialPublicToken,
): Promise<PublicTokenDetailData> {
  const market = await getDexscreenerMarketForMint(official.mint);
  const isMainnet = official.network === "mainnet-beta";
  const now = new Date().toISOString();
  const marketView = resolveMarketViewModel({
    isMainnet,
    mint: official.mint,
    market,
    pumpFun: null, // Official tokens are DEX-listed, not bonding
  });
  // Build the minimal serialized launch shape consumed by the page
  // component. Most AgentLaunch-specific fields are not applicable.
  const launch = {
    id: 0, // Not an AgentLaunch record
    mint: official.mint,
    network: official.network,
    launchKind: "official" as const,
    launchLifecycleStatus: "indexed" as const,
    launchSource: "Official AgentRanking token",
    marketSource: "dexscreener" as const,
    agentId: null,
    tokenName: official.name,
    tokenSymbol: official.symbol,
    tokenDescription: official.description,
    tokenImageUrl: official.imageUrl,
    tokenMetadataUri: null,
    profileDisplayName: official.name,
    profileShortDescription: official.description,
    profileLongDescription: null,
    profileAvatarUrl: official.imageUrl,
    profileBannerUrl: null,
    profileWebsite: official.websiteUrl,
    profileTwitter: official.xUrl,
    profileTelegram: official.telegramUrl,
    profileGithub: null,
    profileTags: [],
    agentWalletPublic: null,
    creatorWalletPublic: null,
    treasuryWalletPublic: null,
    creatorShareBps: 0,
    arShareBps: 0,
    feeSharingStatus: "inactive",
    creationFeeLamports: "0",
    creationTx: null,
    totalArFeesLamports: "0",
    totalCreatorFeesLamports: "0",
    totalFeesDistributedLamports: "0",
    lastDistributionAt: null,
    agentPassportJson: null,
    passportArcPath: null,
    passportOwnerPath: null,
    arTokenVerificationStatus: "verified",
    createdAt: now,
    updatedAt: now,
  };
  const profile: LaunchDisplayProfile = {
    displayName: official.name,
    shortDescription: official.description,
    longDescription: null,
    avatarUrl: official.imageUrl,
    bannerUrl: null,
    website: official.websiteUrl,
    twitter: official.xUrl,
    telegram: official.telegramUrl,
    github: null,
    tags: [],
  };
  return {
    kind: "official",
    launch: launch as unknown as ReturnType<typeof serializeAgentLaunch>,
    profile,
    linkedAgent: null,
    distributions: [],
    totals: {
      totalFeesDistributedLamports: "0",
      totalCreatorFeesLamports: "0",
      totalArFeesLamports: "0",
      lastDistributionAt: null,
    },
    networkLabel: "Mainnet",
    isMainnet: true,
    isDevnet: false,
    marketView,
    pumpFun: null,
    official,
  };
}
