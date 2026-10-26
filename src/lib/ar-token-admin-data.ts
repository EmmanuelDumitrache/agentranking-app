import { prisma } from "@/lib/db";
import {
  AR_DEX_PAIR_ADDRESS,
  AR_DEXSCREENER_URL,
  AR_LAUNCH_STATUS,
  AR_OPS_WALLET,
  AR_PUMPFUN_URL,
  AR_SOLANA_MINT,
  AR_TOKEN_DECIMALS,
} from "@/lib/ar-token-public";
import {
  AR_TOKEN_SETTING_ID,
  DEFAULT_AR_TOKEN_PERK_CONFIGS,
  buildArTokenMetrics,
} from "@/lib/ar-token-metrics";
/** Persist canonical mint in DB when row is missing or still pre-launch placeholder. */
export async function ensureLiveArTokenSettings() {
  const existing = await prisma.arTokenSettings.findUnique({ where: { id: AR_TOKEN_SETTING_ID } });
  if (existing?.tokenAddress?.trim()) return;
  await prisma.arTokenSettings.upsert({
    where: { id: AR_TOKEN_SETTING_ID },
    create: {
      id: AR_TOKEN_SETTING_ID,
      launchStatus: AR_LAUNCH_STATUS,
      tokenAddress: AR_SOLANA_MINT,
      pairAddress: AR_DEX_PAIR_ADDRESS,
      dexScreenerUrl: AR_DEXSCREENER_URL,
      pumpFunUrl: AR_PUMPFUN_URL,
      buyUrl: AR_PUMPFUN_URL,
      buybackWallet: AR_OPS_WALLET,
      burnWallet: AR_OPS_WALLET,
      tokenLedger: "solana",
      tokenDecimals: AR_TOKEN_DECIMALS,
      solanaCluster: "mainnet-beta",
    },
    update: {
      launchStatus: AR_LAUNCH_STATUS,
      tokenAddress: AR_SOLANA_MINT,
      pairAddress: AR_DEX_PAIR_ADDRESS,
      dexScreenerUrl: AR_DEXSCREENER_URL,
      pumpFunUrl: AR_PUMPFUN_URL,
      buyUrl: AR_PUMPFUN_URL,
      buybackWallet: AR_OPS_WALLET,
      burnWallet: AR_OPS_WALLET,
      tokenLedger: "solana",
      tokenDecimals: AR_TOKEN_DECIMALS,
    },
  });
}
export async function ensureDefaultArTokenPerks() {
  await Promise.all(
    DEFAULT_AR_TOKEN_PERK_CONFIGS.map((perk) =>
      prisma.arTokenPerkConfig.upsert({
        where: { slug: perk.slug },
        create: {
          slug: perk.slug,
          title: perk.title,
          shortTitle: perk.shortTitle,
          description: perk.description,
          rewardSummary: perk.rewardSummary,
          minBalanceRaw: perk.minBalanceRaw,
          maxBalanceRaw: perk.maxBalanceRaw,
          status: perk.status,
          displayOrder: perk.displayOrder,
          ctaLabel: perk.ctaLabel,
          ctaHref: perk.ctaHref,
        },
        update: {},
      }),
    ),
  );
}
export async function readArTokenMetricsPayload(options: { includeAdminRows?: boolean } = {}) {
  const devFast = process.env.NODE_ENV === "development";
  try {
    await Promise.all([ensureDefaultArTokenPerks(), ensureLiveArTokenSettings()]);
  } catch (error) {
    if (devFast) return buildArTokenMetrics(null, []);
    throw error;
  }
  const holderTake = options.includeAdminRows ? 100 : 8;
  const referralTake = options.includeAdminRows ? 100 : 8;
  const payoutTake = options.includeAdminRows ? 50 : 5;
  const loadRows = () =>
    Promise.all([
      prisma.arTokenSettings.findUnique({ where: { id: AR_TOKEN_SETTING_ID } }),
      prisma.arTokenMetricEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 250 }),
      prisma.arTokenPerkConfig.findMany({ orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] }),
      prisma.arTokenHolderSnapshot.findMany({
        orderBy: [{ tokenBalanceRaw: "desc" }, { updatedAt: "desc" }],
        take: holderTake,
      }),
      prisma.arTokenHolderSnapshot.count(),
      prisma.arReferralCode.findMany({
        orderBy: { updatedAt: "desc" },
        take: referralTake,
        include: {
          events: { select: { conversionStatus: true } },
          adjustments: { select: { amount: true } },
        },
      }),
      prisma.arReferralEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: referralTake,
        include: { referralCode: { select: { code: true } } },
      }),
      prisma.arPayoutWallet.findMany({ orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }], take: payoutTake }),
      prisma.arPayoutBatch.findMany({ orderBy: { createdAt: "desc" }, take: payoutTake }),
    ]);
  let rows: Awaited<ReturnType<typeof loadRows>>;
  try {
    rows = await loadRows();
  } catch (error) {
    if (devFast) return buildArTokenMetrics(null, []);
    throw error;
  }
  const [
    settings,
    events,
    perks,
    holders,
    holderTotal,
    referralCodes,
    referralEvents,
    payoutWallets,
    payoutBatches,
  ] = rows;
  return buildArTokenMetrics(settings, events, {
    perks,
    holders,
    holderTotal,
    referralCodes,
    referralEvents,
    payoutWallets,
    payoutBatches,
  });
}