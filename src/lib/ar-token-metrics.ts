import {
  AR_DEX_PAIR_ADDRESS,
  AR_LAUNCH_STATUS,
  AR_SOLANA_CLUSTER,
  AR_TOKEN_DECIMALS,
  resolveArDexScreenerUrl,
  resolveArPumpFunUrl,
  resolveArSolanaMint,
} from "@/lib/ar-token-public";
import { getStakeSiteUrl } from "@/lib/site-url";
export const AR_TOKEN_SETTING_ID = 1;
/** Fill missing admin/DB fields with the canonical live mint and market URLs. */
export function mergeArTokenPublicDefaults(settings: ArTokenSettingsView): ArTokenSettingsView {
  const tokenAddress = settings.tokenAddress.trim() || resolveArSolanaMint();
  const hadDbMint = Boolean(settings.tokenAddress.trim());
  return {
    ...settings,
    launchStatus:
      hadDbMint && settings.launchStatus !== "prelaunch"
        ? settings.launchStatus
        : AR_LAUNCH_STATUS,
    tokenAddress,
    pairAddress: settings.pairAddress.trim() || AR_DEX_PAIR_ADDRESS,
    dexScreenerUrl: settings.dexScreenerUrl.trim() || resolveArDexScreenerUrl(),
    pumpFunUrl: settings.pumpFunUrl.trim() || resolveArPumpFunUrl(),
    buyUrl: settings.buyUrl.trim() || resolveArPumpFunUrl(),
    tokenLedger: "solana",
    solanaCluster: settings.solanaCluster?.trim() || AR_SOLANA_CLUSTER,
    tokenDecimals: hadDbMint ? settings.tokenDecimals : AR_TOKEN_DECIMALS,
  };
}
export const AR_TOKEN_EVENT_TYPES = [
  "burn",
  "buyback",
  "treasury_in",
  "treasury_out",
  "bounty_reward",
  "staking_reward",
  "staking_deposit",
  "staking_withdrawal",
  "liquidity_add",
  "liquidity_remove",
  "revenue_fee",
] as const;
export type ArTokenEventType = (typeof AR_TOKEN_EVENT_TYPES)[number];
export type ArTokenSettingsView = {
  launchStatus: string;
  tokenAddress: string;
  pairAddress: string;
  dexScreenerUrl: string;
  pumpFunUrl: string;
  buyUrl: string;
  treasuryWallet: string;
  rewardsWallet: string;
  buybackWallet: string;
  burnWallet: string;
  liquidityWallet: string;
  holderAccessThreshold: string;
  /** `evm` = wagmi + ERC-20; `solana` = Phantom + SPL mint balance. */
  tokenLedger: "evm" | "solana";
  /** mainnet-beta | devnet | testnet when tokenLedger is solana. */
  solanaCluster: string;
  /** EIP-155 chain id for token reads; 0 = unset (use NEXT_PUBLIC_AR_TOKEN_CHAIN_ID). */
  tokenChainId: number;
  /** Decimals hint (EVM) or SPL mint decimals (Solana) when not read on-chain. */
  tokenDecimals: number;
  stakingEnabled: boolean;
  updatedAt: string | null;
};
export type ArTokenEventView = {
  id: string;
  eventType: ArTokenEventType;
  amountToken: string;
  amountUsd: string;
  wallet: string;
  txHash: string;
  note: string;
  occurredAt: string;
  createdAt: string;
};
export type ArTokenPerkConfigView = {
  id: string;
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  rewardSummary: string;
  minBalanceRaw: string;
  maxBalanceRaw: string;
  status: "active" | "coming_soon" | "hidden";
  displayOrder: number;
  ctaLabel: string;
  ctaHref: string;
  updatedAt: string | null;
};
export type ArTokenHolderSnapshotView = {
  id: string;
  wallet: string;
  tokenBalanceRaw: string;
  tokenBalanceUi: string;
  achievedTier: string;
  eligiblePerks: string[];
  referralCount: number;
  manualReferralAdjust: number;
  paidVerifiedAgentCount: number;
  claimedAgentCount: number;
  profilePath: string;
  source: string;
  note: string;
  lastSyncedAt: string;
};
export type ArReferralCodeView = {
  id: string;
  code: string;
  ownerWallet: string;
  destination: string;
  isActive: boolean;
  qualifiedCount: number;
  pendingCount: number;
  manualAdjust: number;
  bonusEligible: boolean;
  paidVerifiedAgentBoost: boolean;
  updatedAt: string;
};
export type ArReferralEventView = {
  id: string;
  code: string;
  referrerWallet: string;
  referredWallet: string;
  eventType: string;
  conversionStatus: string;
  spamReason: string;
  createdAt: string;
};
export type ArPayoutWalletView = {
  id: string;
  label: string;
  wallet: string;
  asset: string;
  purpose: string;
  isActive: boolean;
  updatedAt: string;
};
export type ArPayoutBatchView = {
  id: string;
  title: string;
  perkSlug: string;
  asset: string;
  amountMode: string;
  amountValue: string;
  totalAmount: string;
  recipientCount: number;
  recipients: Array<{ wallet: string; amount: string; note?: string }>;
  status: string;
  txSignatures: string[];
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
};
export type ArTokenMetricsView = {
  settings: ArTokenSettingsView;
  totals: {
    totalBurnedToken: number;
    totalBuybackUsd: number;
    totalRewardsToken: number;
    totalBountyRewardsToken: number;
    totalRevenueUsd: number;
    treasuryNetUsd: number;
    liquidityNetToken: number;
    stakedSupplyToken: number;
    activeStakers: number;
  };
  history: {
    burnEvents: ArTokenEventView[];
    buybackEvents: ArTokenEventView[];
    rewardEvents: ArTokenEventView[];
    stakingEvents: ArTokenEventView[];
    treasuryEvents: ArTokenEventView[];
    recentEvents: ArTokenEventView[];
  };
  perks: ArTokenPerkConfigView[];
  holders: {
    total: number;
    top: ArTokenHolderSnapshotView[];
  };
  referrals: {
    totalCodes: number;
    totalQualified: number;
    totalPending: number;
    bonusEligibleCount: number;
    codes: ArReferralCodeView[];
    recentEvents: ArReferralEventView[];
  };
  payout: {
    wallets: ArPayoutWalletView[];
    batches: ArPayoutBatchView[];
  };
};
type RawSettings = {
  launchStatus: string;
  tokenAddress: string;
  pairAddress: string;
  dexScreenerUrl: string;
  pumpFunUrl: string;
  buyUrl: string;
  treasuryWallet: string;
  rewardsWallet: string;
  buybackWallet: string;
  burnWallet: string;
  liquidityWallet: string;
  holderAccessThreshold: string;
  tokenLedger?: string;
  solanaCluster?: string;
  tokenChainId: number;
  tokenDecimals: number;
  stakingEnabled: boolean;
  updatedAt: Date;
} | null;
type RawEvent = {
  id: string;
  eventType: string;
  amountToken: string;
  amountUsd: string;
  wallet: string;
  txHash: string;
  note: string;
  occurredAt: Date;
  createdAt: Date;
};
type RawPerk = {
  id: string;
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  rewardSummary: string;
  minBalanceRaw: string;
  maxBalanceRaw: string;
  status: string;
  displayOrder: number;
  ctaLabel: string;
  ctaHref: string;
  updatedAt: Date;
};
type RawHolder = {
  id: string;
  wallet: string;
  tokenBalanceRaw: string;
  tokenBalanceUi: string;
  achievedTier: string;
  eligiblePerks: string[];
  referralCount: number;
  manualReferralAdjust: number;
  paidVerifiedAgentCount: number;
  claimedAgentCount: number;
  profilePath: string;
  source: string;
  note: string;
  lastSyncedAt: Date;
};
type RawReferralCode = {
  id: string;
  code: string;
  ownerWallet: string;
  destination: string;
  isActive: boolean;
  updatedAt: Date;
  events?: Array<{ conversionStatus: string }>;
  adjustments?: Array<{ amount: number }>;
};
type RawReferralEvent = {
  id: string;
  referrerWallet: string;
  referredWallet: string;
  eventType: string;
  conversionStatus: string;
  spamReason: string;
  createdAt: Date;
  referralCode?: { code: string };
};
type RawPayoutWallet = {
  id: string;
  label: string;
  wallet: string;
  asset: string;
  purpose: string;
  isActive: boolean;
  updatedAt: Date;
};
type RawPayoutBatch = {
  id: string;
  title: string;
  perkSlug: string;
  asset: string;
  amountMode: string;
  amountValue: string;
  totalAmount: string;
  recipientCount: number;
  recipients: unknown;
  status: string;
  txSignatures: string[];
  adminNotes: string;
  createdAt: Date;
  updatedAt: Date;
};
export type ArTokenMetricsExtras = {
  perks?: RawPerk[];
  holders?: RawHolder[];
  holderTotal?: number;
  referralCodes?: RawReferralCode[];
  referralEvents?: RawReferralEvent[];
  payoutWallets?: RawPayoutWallet[];
  payoutBatches?: RawPayoutBatch[];
};
export const DEFAULT_AR_TOKEN_PERK_CONFIGS = [
  {
    slug: "dashboard-access",
    title: "Agent Dashboard access",
    shortTitle: "Dashboard",
    description: "Hold $AR to unlock agent management, richer Agent Dashboard controls, and full access at the top tier.",
    rewardSummary: "Mid tier: manage a claimed agent. Max tier: full Agent Dashboard access and priority surfaces.",
    minBalanceRaw: "10000000000000000000000",
    maxBalanceRaw: "100000000000000000000000",
    status: "active",
    displayOrder: 10,
    ctaLabel: "Open Agent Dashboard",
    ctaHref: "/dashboard",
  },
  {
    slug: "bounty-priority",
    title: "MCP Jobs priority",
    shortTitle: "MCP Jobs",
    description: "Eligible holders can claim job lanes and qualify for admin-reviewed bonus rewards.",
    rewardSummary: "Automatic job splits are in development; MVP rewards are reviewed before payout.",
    minBalanceRaw: "25000000000000000000000",
    maxBalanceRaw: "100000000000000000000000",
    status: "active",
    displayOrder: 20,
    ctaLabel: "View MCP Jobs",
    ctaHref: "/jobs",
  },
  {
    slug: "contributor-rewards",
    title: "Contributor rewards",
    shortTitle: "Contributor",
    description: "Claim agents, improve listings, and drive verified usage or feedback to qualify for bonus rewards.",
    rewardSummary: "Usage and feedback are reviewed with anti-spam checks before monthly reward batches.",
    minBalanceRaw: "50000000000000000000000",
    maxBalanceRaw: "100000000000000000000000",
    status: "active",
    displayOrder: 30,
    ctaLabel: "Manage profile",
    ctaHref: "/dashboard",
  },
  {
    slug: "mcp-publishing",
    title: "MCP publishing",
    shortTitle: "MCP",
    description: "Publish and manage MCP service offers for verified or claimed agents.",
    rewardSummary: "Future platform fee alignment may route eligible revenue into rewards and burns.",
    minBalanceRaw: "50000000000000000000000",
    maxBalanceRaw: "100000000000000000000000",
    status: "coming_soon",
    displayOrder: 40,
    ctaLabel: "Explore MCP",
    ctaHref: "/dashboard",
  },
  {
    slug: "referral-growth",
    title: "Referral growth",
    shortTitle: "Referrals",
    description: "Share a unique link, bring in verified users or agents, and qualify for holder referral bonuses.",
    rewardSummary: "Five qualified referrals unlock a small bonus flag; paid verified agents boost monthly eligibility.",
    minBalanceRaw: "1000000000000000000000",
    maxBalanceRaw: "100000000000000000000000",
    status: "active",
    displayOrder: 50,
    ctaLabel: "Copy referral link",
    ctaHref: getStakeSiteUrl(),
  },
] as const;
export function isArTokenEventType(value: string): value is ArTokenEventType {
  return AR_TOKEN_EVENT_TYPES.includes(value as ArTokenEventType);
}
export function emptyArTokenSettings(): ArTokenSettingsView {
  return {
    launchStatus: "prelaunch",
    tokenAddress: "",
    pairAddress: "",
    dexScreenerUrl: "",
    pumpFunUrl: "",
    buyUrl: "",
    treasuryWallet: "",
    rewardsWallet: "",
    buybackWallet: "",
    burnWallet: "",
    liquidityWallet: "",
    holderAccessThreshold: "",
    tokenLedger: "evm",
    solanaCluster: "mainnet-beta",
    tokenChainId: 0,
    tokenDecimals: 18,
    stakingEnabled: false,
    updatedAt: null,
  };
}
export function emptyArTokenMetrics(): ArTokenMetricsView {
  return {
    settings: emptyArTokenSettings(),
    totals: {
      totalBurnedToken: 0,
      totalBuybackUsd: 0,
      totalRewardsToken: 0,
      totalBountyRewardsToken: 0,
      totalRevenueUsd: 0,
      treasuryNetUsd: 0,
      liquidityNetToken: 0,
      stakedSupplyToken: 0,
      activeStakers: 0,
    },
    history: {
      burnEvents: [],
      buybackEvents: [],
      rewardEvents: [],
      stakingEvents: [],
      treasuryEvents: [],
      recentEvents: [],
    },
    perks: defaultArTokenPerkViews(),
    holders: { total: 0, top: [] },
    referrals: {
      totalCodes: 0,
      totalQualified: 0,
      totalPending: 0,
      bonusEligibleCount: 0,
      codes: [],
      recentEvents: [],
    },
    payout: {
      wallets: [],
      batches: [],
    },
  };
}
function normalizePerkStatus(status: string): ArTokenPerkConfigView["status"] {
  if (status === "coming_soon" || status === "hidden") return status;
  return "active";
}
function payoutRecipients(value: unknown): ArPayoutBatchView["recipients"] {
  if (!Array.isArray(value)) return [];
  const recipients: ArPayoutBatchView["recipients"] = [];
  for (const item of value) {
    if (typeof item === "object" && item != null) {
      const row = item as { wallet?: unknown; amount?: unknown; note?: unknown };
      const wallet = typeof row.wallet === "string" ? row.wallet : "";
      const amount = typeof row.amount === "string" ? row.amount : "";
      if (wallet && amount) {
        const note = typeof row.note === "string" ? row.note : undefined;
        recipients.push(note ? { wallet, amount, note } : { wallet, amount });
      }
    }
  }
  return recipients;
}
export function defaultArTokenPerkViews(): ArTokenPerkConfigView[] {
  return DEFAULT_AR_TOKEN_PERK_CONFIGS.map((perk, index) => ({
    id: perk.slug,
    slug: perk.slug,
    title: perk.title,
    shortTitle: perk.shortTitle,
    description: perk.description,
    rewardSummary: perk.rewardSummary,
    minBalanceRaw: perk.minBalanceRaw,
    maxBalanceRaw: perk.maxBalanceRaw,
    status: normalizePerkStatus(perk.status),
    displayOrder: perk.displayOrder || index * 10,
    ctaLabel: perk.ctaLabel,
    ctaHref: perk.ctaHref,
    updatedAt: null,
  }));
}
export function normalizeArTokenSettings(settings: RawSettings): ArTokenSettingsView {
  if (!settings) return mergeArTokenPublicDefaults(emptyArTokenSettings());
  const updatedAt =
    settings.updatedAt && !Number.isNaN(settings.updatedAt.getTime())
      ? settings.updatedAt.toISOString()
      : null;
  return mergeArTokenPublicDefaults({
    launchStatus: settings.launchStatus,
    tokenAddress: settings.tokenAddress,
    pairAddress: settings.pairAddress,
    dexScreenerUrl: settings.dexScreenerUrl,
    pumpFunUrl: settings.pumpFunUrl,
    buyUrl: settings.buyUrl,
    treasuryWallet: settings.treasuryWallet,
    rewardsWallet: settings.rewardsWallet,
    buybackWallet: settings.buybackWallet,
    burnWallet: settings.burnWallet,
    liquidityWallet: settings.liquidityWallet,
    holderAccessThreshold: settings.holderAccessThreshold,
    tokenLedger: settings.tokenLedger === "solana" ? "solana" : "evm",
    solanaCluster: settings.solanaCluster?.trim() || "mainnet-beta",
    tokenChainId: settings.tokenChainId,
    tokenDecimals: settings.tokenDecimals,
    stakingEnabled: settings.stakingEnabled,
    updatedAt,
  });
}
export function toArTokenEventView(event: RawEvent): ArTokenEventView {
  return {
    id: event.id,
    eventType: isArTokenEventType(event.eventType) ? event.eventType : "revenue_fee",
    amountToken: event.amountToken,
    amountUsd: event.amountUsd,
    wallet: event.wallet,
    txHash: event.txHash,
    note: event.note,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
  };
}
function parseAmount(value: string): number {
  const normalized = value.replaceAll(",", "").trim();
  if (!normalized) return 0;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
function sumEvents(events: ArTokenEventView[], type: ArTokenEventType, key: "amountToken" | "amountUsd"): number {
  return events
    .filter((event) => event.eventType === type)
    .reduce((sum, event) => sum + parseAmount(event[key]), 0);
}
function normalizePerks(perks?: RawPerk[]): ArTokenPerkConfigView[] {
  const rows = perks?.length ? perks : [];
  if (rows.length === 0) return defaultArTokenPerkViews();
  return rows
    .map((perk) => ({
      id: perk.id,
      slug: perk.slug,
      title: perk.title,
      shortTitle: perk.shortTitle,
      description: perk.description,
      rewardSummary: perk.rewardSummary,
      minBalanceRaw: perk.minBalanceRaw,
      maxBalanceRaw: perk.maxBalanceRaw,
      status: normalizePerkStatus(perk.status),
      displayOrder: perk.displayOrder,
      ctaLabel: perk.ctaLabel,
      ctaHref: perk.ctaHref,
      updatedAt: perk.updatedAt.toISOString(),
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}
function normalizeHolders(holders?: RawHolder[]): ArTokenHolderSnapshotView[] {
  return (holders ?? []).map((holder) => ({
    id: holder.id,
    wallet: holder.wallet,
    tokenBalanceRaw: holder.tokenBalanceRaw,
    tokenBalanceUi: holder.tokenBalanceUi,
    achievedTier: holder.achievedTier,
    eligiblePerks: holder.eligiblePerks,
    referralCount: holder.referralCount,
    manualReferralAdjust: holder.manualReferralAdjust,
    paidVerifiedAgentCount: holder.paidVerifiedAgentCount,
    claimedAgentCount: holder.claimedAgentCount,
    profilePath: holder.profilePath,
    source: holder.source,
    note: holder.note,
    lastSyncedAt: holder.lastSyncedAt.toISOString(),
  }));
}
function normalizeReferralCodes(codes?: RawReferralCode[], holders?: RawHolder[]): ArReferralCodeView[] {
  const holderByWallet = new Map(
    (holders ?? [])
      .filter((holder) => typeof holder.wallet === "string" && holder.wallet.trim() !== "")
      .map((holder) => [holder.wallet.toLowerCase(), holder]),
  );
  return (codes ?? []).map((code) => {
    const qualifiedCount = (code.events ?? []).filter((event) => event.conversionStatus === "qualified").length;
    const pendingCount = (code.events ?? []).filter((event) => event.conversionStatus === "pending").length;
    const manualAdjust = (code.adjustments ?? []).reduce(
      (sum, row) => sum + (typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : 0),
      0,
    );
    const ownerKey = typeof code.ownerWallet === "string" ? code.ownerWallet.toLowerCase() : "";
    const holder = ownerKey ? holderByWallet.get(ownerKey) : undefined;
    const effectiveQualified = qualifiedCount + manualAdjust;
    return {
      id: code.id,
      code: code.code,
      ownerWallet: code.ownerWallet,
      destination: code.destination,
      isActive: code.isActive,
      qualifiedCount,
      pendingCount,
      manualAdjust,
      bonusEligible: effectiveQualified >= 5,
      paidVerifiedAgentBoost: (holder?.paidVerifiedAgentCount ?? 0) > 0,
      updatedAt: code.updatedAt.toISOString(),
    };
  });
}
function normalizeReferralEvents(events?: RawReferralEvent[]): ArReferralEventView[] {
  return (events ?? []).map((event) => ({
    id: event.id,
    code: event.referralCode?.code ?? "",
    referrerWallet: event.referrerWallet,
    referredWallet: event.referredWallet,
    eventType: event.eventType,
    conversionStatus: event.conversionStatus,
    spamReason: event.spamReason,
    createdAt: event.createdAt.toISOString(),
  }));
}
function normalizePayoutWallets(wallets?: RawPayoutWallet[]): ArPayoutWalletView[] {
  return (wallets ?? []).map((wallet) => ({
    id: wallet.id,
    label: wallet.label,
    wallet: wallet.wallet,
    asset: wallet.asset,
    purpose: wallet.purpose,
    isActive: wallet.isActive,
    updatedAt: wallet.updatedAt.toISOString(),
  }));
}
function normalizePayoutBatches(batches?: RawPayoutBatch[]): ArPayoutBatchView[] {
  return (batches ?? []).map((batch) => ({
    id: batch.id,
    title: batch.title,
    perkSlug: batch.perkSlug,
    asset: batch.asset,
    amountMode: batch.amountMode,
    amountValue: batch.amountValue,
    totalAmount: batch.totalAmount,
    recipientCount: batch.recipientCount,
    recipients: payoutRecipients(batch.recipients),
    status: batch.status,
    txSignatures: batch.txSignatures,
    adminNotes: batch.adminNotes,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  }));
}
export function buildArTokenMetrics(
  settings: RawSettings,
  rawEvents: RawEvent[],
  extras: ArTokenMetricsExtras = {}
): ArTokenMetricsView {
  const normalizedSettings = normalizeArTokenSettings(settings);
  const events = rawEvents.map(toArTokenEventView);
  const stakingDeposits = events.filter((event) => event.eventType === "staking_deposit");
  const stakingWallets = new Set(
    stakingDeposits
      .map((event) => {
        const wallet = typeof event.wallet === "string" ? event.wallet.trim() : "";
        return normalizedSettings.tokenLedger === "evm" ? wallet.toLowerCase() : wallet;
      })
      .filter(Boolean)
  );
  const holders = normalizeHolders(extras.holders);
  const referralCodes = normalizeReferralCodes(extras.referralCodes, extras.holders);
  const totalQualified = referralCodes.reduce((sum, code) => sum + code.qualifiedCount + code.manualAdjust, 0);
  return {
    settings: normalizedSettings,
    totals: {
      totalBurnedToken: sumEvents(events, "burn", "amountToken"),
      totalBuybackUsd: sumEvents(events, "buyback", "amountUsd"),
      totalRewardsToken:
        sumEvents(events, "bounty_reward", "amountToken") + sumEvents(events, "staking_reward", "amountToken"),
      totalBountyRewardsToken: sumEvents(events, "bounty_reward", "amountToken"),
      totalRevenueUsd: sumEvents(events, "revenue_fee", "amountUsd"),
      treasuryNetUsd: sumEvents(events, "treasury_in", "amountUsd") - sumEvents(events, "treasury_out", "amountUsd"),
      liquidityNetToken: sumEvents(events, "liquidity_add", "amountToken") - sumEvents(events, "liquidity_remove", "amountToken"),
      stakedSupplyToken: sumEvents(events, "staking_deposit", "amountToken") - sumEvents(events, "staking_withdrawal", "amountToken"),
      activeStakers: stakingWallets.size,
    },
    history: {
      burnEvents: events.filter((event) => event.eventType === "burn"),
      buybackEvents: events.filter((event) => event.eventType === "buyback"),
      rewardEvents: events.filter((event) => event.eventType === "bounty_reward" || event.eventType === "staking_reward"),
      stakingEvents: events.filter((event) => event.eventType === "staking_deposit" || event.eventType === "staking_withdrawal"),
      treasuryEvents: events.filter((event) => event.eventType === "treasury_in" || event.eventType === "treasury_out"),
      recentEvents: events.slice(0, 12),
    },
    perks: normalizePerks(extras.perks),
    holders: {
      total: extras.holderTotal ?? holders.length,
      top: holders,
    },
    referrals: {
      totalCodes: referralCodes.length,
      totalQualified,
      totalPending: referralCodes.reduce((sum, code) => sum + code.pendingCount, 0),
      bonusEligibleCount: referralCodes.filter((code) => code.bonusEligible).length,
      codes: referralCodes,
      recentEvents: normalizeReferralEvents(extras.referralEvents),
    },
    payout: {
      wallets: normalizePayoutWallets(extras.payoutWallets),
      batches: normalizePayoutBatches(extras.payoutBatches),
    },
  };
}
