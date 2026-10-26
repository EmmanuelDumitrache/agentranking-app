import "server-only";
import { publicTokenDetailHref } from "@/lib/public-site/routes";
import { getStakeSiteUrl } from "@/lib/site-url";
import { formatSolFromLamports, formatUsdCompact } from "@/lib/public-site/ar-live-feed-format";
import type { ArLiveFeedChain, ArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-types";
import { agentPublicPath } from "@/lib/agent-public-url";
export function buildAgentLaunchFeedEvent(input: {
  agentDbId: number;
  chainId: number;
  agentId: number;
  name: string;
  description?: string | null;
  listedAt?: Date | string | null;
}): ArLiveFeedEvent {
  const occurredAt = toIso(input.listedAt);
  return {
    id: `agent:native:${input.agentDbId}`,
    kind: "agent_launch",
    chain: "solana",
    title: `${input.name} launched`,
    subtitle: input.description ? truncateText(input.description, 96) : undefined,
    symbol: null,
    name: input.name,
    amountLabel: null,
    href: agentPublicPath(input),
    occurredAt,
  };
}
export function buildTokenLaunchFeedEvent(input: {
  launchId: string;
  mint: string;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  profileDisplayName?: string | null;
  agentName?: string | null;
  createdAt?: Date | string | null;
  chain?: ArLiveFeedChain;
}): ArLiveFeedEvent {
  const symbol = cleanSymbol(input.tokenSymbol);
  const name = input.profileDisplayName ?? input.tokenName ?? null;
  const tokenLabel = symbol ? `$${symbol}` : name ?? "Token";
  const chain = input.chain ?? "solana";
  return {
    id: `launch:${chain}:${input.launchId}`,
    kind: "token_launch",
    chain,
    title: `${tokenLabel} launched`,
    subtitle: input.agentName ? `${input.agentName} token launch` : undefined,
    symbol,
    name,
    amountLabel: null,
    href:
      chain === "robinhood"
        ? `/tokens/robinhood/${input.mint}`
        : publicTokenDetailHref(input.mint),
    occurredAt: toIso(input.createdAt),
  };
}
export function buildFeeDistributionFeedEvent(input: {
  distributionId: string;
  mint: string;
  creatorAmountLamports: bigint | number | string;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  createdAt?: Date | string | null;
}): ArLiveFeedEvent {
  const symbol = cleanSymbol(input.tokenSymbol);
  const tokenLabel = symbol ? `$${symbol}` : input.tokenName ?? "Token";
  const amountLabel = formatSolFromLamports(input.creatorAmountLamports);
  return {
    id: `fees:dist:${input.distributionId}`,
    kind: "fees",
    chain: "solana",
    title: amountLabel
      ? `${tokenLabel} · ${amountLabel} creator fees claimed`
      : `${tokenLabel} · creator fees claimed`,
    subtitle: undefined,
    symbol,
    name: input.tokenName ?? null,
    amountLabel,
    href: publicTokenDetailHref(input.mint),
    occurredAt: toIso(input.createdAt),
  };
}
export function buildAgentVerifiedFeedEvent(input: {
  agentDbId: number;
  chainId: number;
  agentId: number;
  name: string;
  verifiedAt?: Date | string | null;
}): ArLiveFeedEvent {
  return {
    id: `verified:agent:${input.agentDbId}`,
    kind: "verified",
    chain: "solana",
    title: `${input.name} verified`,
    symbol: null,
    name: input.name,
    amountLabel: null,
    href: agentPublicPath(input),
    occurredAt: toIso(input.verifiedAt),
  };
}
export function buildTokenVerifiedFeedEvent(input: {
  launchId: string;
  mint: string;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  verifiedAt?: Date | string | null;
}): ArLiveFeedEvent {
  const symbol = cleanSymbol(input.tokenSymbol);
  const tokenLabel = symbol ? `$${symbol}` : input.tokenName ?? "Token";
  return {
    id: `verified:token:${input.launchId}`,
    kind: "verified",
    chain: "solana",
    title: `${tokenLabel} verified`,
    symbol,
    name: input.tokenName ?? null,
    amountLabel: null,
    href: publicTokenDetailHref(input.mint),
    occurredAt: toIso(input.verifiedAt),
  };
}
export function buildBondingMilestoneFeedEvent(input: {
  mint: string;
  threshold: number;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  href?: string;
}): ArLiveFeedEvent {
  const symbol = cleanSymbol(input.tokenSymbol);
  const tokenLabel = symbol ? `$${symbol}` : input.tokenName ?? "Token";
  const title =
    input.threshold >= 100
      ? `${tokenLabel} graduated`
      : `${tokenLabel} at ${input.threshold}% to graduation`;
  return {
    id: `milestone:bond:${input.mint}:${input.threshold}`,
    kind: "milestone",
    chain: "solana",
    title,
    symbol,
    name: input.tokenName ?? null,
    amountLabel: null,
    href: input.href ?? publicTokenDetailHref(input.mint),
    occurredAt: new Date().toISOString(),
  };
}
export function buildHolderMilestoneFeedEvent(input: {
  mint: string;
  threshold: number;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  href?: string;
}): ArLiveFeedEvent {
  const symbol = cleanSymbol(input.tokenSymbol);
  const tokenLabel = symbol ? `$${symbol}` : input.tokenName ?? "Token";
  return {
    id: `milestone:holders:${input.mint}:${input.threshold}`,
    kind: "milestone",
    chain: "solana",
    title: `${tokenLabel} reached ${input.threshold} holders`,
    symbol,
    name: input.tokenName ?? null,
    amountLabel: String(input.threshold),
    href: input.href ?? publicTokenDetailHref(input.mint),
    occurredAt: new Date().toISOString(),
  };
}
export function buildFeesDigestFeedEvent(input: {
  window: "today" | "week";
  creatorLamports: bigint;
  dayKey: string;
}): ArLiveFeedEvent | null {
  if (input.creatorLamports <= BigInt(0)) return null;
  const amountLabel = formatSolFromLamports(input.creatorLamports);
  if (!amountLabel) return null;
  const windowLabel = input.window === "today" ? "today" : "this week";
  return {
    id: `digest:fees:${input.window}:${input.dayKey}`,
    kind: "digest",
    chain: "solana",
    title: `${amountLabel} creator fees ${windowLabel}`,
    symbol: null,
    name: null,
    amountLabel,
    href: "/tokens",
    occurredAt: new Date().toISOString(),
  };
}
export function buildTopVolumeDigestFeedEvent(input: {
  dayKey: string;
  mint: string;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  volume24hUsd: number;
}): ArLiveFeedEvent {
  const symbol = cleanSymbol(input.tokenSymbol);
  const tokenLabel = symbol ? `$${symbol}` : input.tokenName ?? "Token";
  const volumeLabel = formatUsdCompact(input.volume24hUsd);
  return {
    id: `digest:volume:${input.dayKey}:${input.mint}`,
    kind: "digest",
    chain: "solana",
    title: volumeLabel
      ? `Top volume · ${tokenLabel} (${volumeLabel})`
      : `Top volume · ${tokenLabel}`,
    symbol,
    name: input.tokenName ?? null,
    amountLabel: volumeLabel,
    href: publicTokenDetailHref(input.mint),
    occurredAt: new Date().toISOString(),
  };
}
export function buildStakeDigestFeedEvent(input: {
  dayKey: string;
  stakedLabel: string;
}): ArLiveFeedEvent {
  return {
    id: `digest:stake:${input.dayKey}`,
    kind: "digest",
    chain: "solana",
    title: `$AR staked · ${input.stakedLabel}`,
    symbol: "AR",
    name: "AgentRanking",
    amountLabel: input.stakedLabel,
    href: getStakeSiteUrl(),
    occurredAt: new Date().toISOString(),
  };
}
function cleanSymbol(symbol: string | null | undefined): string | null {
  const trimmed = symbol?.trim().replace(/^\$/, "");
  return trimmed ? trimmed.toUpperCase() : null;
}
function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
}
function toIso(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}
