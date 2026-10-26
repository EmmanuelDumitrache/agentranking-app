import type { TokenDiscoveryCardModel } from "@/lib/agent-launch/launch-index-data.server";
import { formatCompactPlus, formatInteger } from "@/lib/public-platform-stats";
import { formatUsdCompact } from "@/lib/public-site/formatters";
import type { PublicSiteHomeData } from "@/lib/public-site/home-types";
import type { PublicStakeSummary } from "@/lib/public-stake-summary";

export type LandingHeroStat = {
  readonly label: string;
  readonly value: string;
};

export type LandingTokenCard = {
  readonly id: string;
  readonly href: string;
  readonly initials: string;
  readonly name: string;
  readonly symbol: string;
  readonly chain: string;
  readonly mcap: string;
  readonly vol: string;
  readonly gradPct: number;
  readonly gradLabel: string;
  readonly imageUrl: string | null;
};

export type LandingStakeTier = {
  readonly id: string;
  readonly label: string;
  readonly share: string;
  readonly width: string;
  readonly color: string;
  readonly barColor: string;
};

const DEFAULT_MODELS = [
  "Claude Opus 4.6",
  "GPT-5.2",
  "Gemini 3 Pro",
  "Llama 4",
  "DeepSeek V4",
  "Mistral Large 3",
  "Qwen 3 Max",
  "Grok 4",
  "Command R+",
  "Nova Pro",
  "Phi-4",
  "Kimi K2",
] as const;

const STAKE_TIERS: readonly LandingStakeTier[] = [
  {
    id: "7d",
    label: "7d",
    share: "10%",
    width: "20%",
    color: "rgba(255,255,255,0.55)",
    barColor: "rgba(255,255,255,0.3)",
  },
  {
    id: "30d",
    label: "30d",
    share: "15%",
    width: "30%",
    color: "rgba(255,255,255,0.65)",
    barColor: "rgba(255,255,255,0.45)",
  },
  {
    id: "90d",
    label: "90d",
    share: "25%",
    width: "50%",
    color: "rgba(255,255,255,0.78)",
    barColor: "rgba(255,255,255,0.6)",
  },
  {
    id: "180d",
    label: "180d",
    share: "50%",
    width: "100%",
    color: "#ffffff",
    barColor: "#ffffff",
  },
];

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "AR";
}

export function buildLandingHeroStats(data: PublicSiteHomeData, modelCount = 300): LandingHeroStat[] {
  return [
    { label: "agents indexed", value: formatCompactPlus(data.stats.totalAgents) },
    { label: "chains", value: `${formatInteger(data.stats.totalChains)}+` },
    { label: "models", value: `${formatInteger(modelCount)}+` },
    { label: "tokens launched", value: formatInteger(data.tokenLaunchCount) },
  ];
}

export function mapLandingTokens(tokens: readonly TokenDiscoveryCardModel[]): LandingTokenCard[] {
  return tokens.slice(0, 5).map((token) => {
    const name = token.tokenName?.trim() || "Unnamed";
    const symbol = token.tokenSymbol ? `$${token.tokenSymbol}` : "—";
    const chain = token.chain === "robinhood" ? "RH" : "SOL";
    const gradPct = Math.max(0, Math.min(100, token.graduation?.progressPct ?? 0));
    return {
      id: token.id,
      href: token.detailHref,
      initials: initialsFromName(name),
      name,
      symbol,
      chain,
      mcap: formatUsdCompact(token.market?.marketCapUsd ?? token.market?.fdvUsd),
      vol: formatUsdCompact(token.market?.volume24hUsd),
      gradPct,
      gradLabel: token.graduation?.statusLabel ?? (gradPct >= 100 ? "Graduated" : `Graduation ${gradPct}%`),
      imageUrl: token.tokenImageUrl,
    };
  });
}

export function buildLandingModelMarquee(modelCount = 300): string[] {
  const remainder = Math.max(0, modelCount - DEFAULT_MODELS.length);
  const tail = remainder > 0 ? `+ ${remainder} more` : "+ more";
  return [...DEFAULT_MODELS, tail, ...DEFAULT_MODELS, tail];
}

export function getLandingStakeTiers(): readonly LandingStakeTier[] {
  return STAKE_TIERS;
}

export function formatLandingStakeLabel(summary: PublicStakeSummary | null, locked: boolean): string {
  if (!locked) return "Lock $AR to earn";
  const staked = summary?.totalStakedAr;
  const stakers = summary?.activeStakers;
  if (staked == null || !Number.isFinite(staked) || staked <= 0) {
    return "Staking is live · stake.agentranking.io/stake";
  }
  let stakedLabel: string;
  if (staked >= 1_000_000) {
    stakedLabel = `${(staked / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  } else if (staked >= 1_000) {
    stakedLabel = `${Math.round(staked / 1_000)}K`;
  } else {
    stakedLabel = formatInteger(staked);
  }
  if (stakers != null && Number.isFinite(stakers) && stakers > 0) {
    return `${stakedLabel} $AR locked · ${formatInteger(stakers)} stakers`;
  }
  return `${stakedLabel} $AR locked`;
}
