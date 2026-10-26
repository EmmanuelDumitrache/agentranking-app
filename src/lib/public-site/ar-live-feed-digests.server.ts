import "server-only";
import { prisma } from "@/lib/db";
import { getAgentLaunchNetwork } from "@/lib/agent-launch/solana";
import { readArTokenMetricsPayload } from "@/lib/ar-token-admin-data";
import { getDexscreenerMarketsForMints } from "@/lib/public-site/dexscreener";
import {
  buildFeesDigestFeedEvent,
  buildStakeDigestFeedEvent,
  buildTopVolumeDigestFeedEvent,
} from "@/lib/public-site/ar-live-feed-builders.server";
import type { ArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-types";
function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
function startOfUtcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function startOfUtcWeek(date = new Date()): Date {
  const day = startOfUtcDay(date);
  const weekday = day.getUTCDay(); // 0 Sun
  day.setUTCDate(day.getUTCDate() - weekday);
  return day;
}
function formatTokenCompact(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
/** Rotate through fee / volume / stake digests. Returns 0–1 events. */
export async function loadArLiveFeedDigestEvents(
  rotation: number,
): Promise<ArLiveFeedEvent[]> {
  const loaders = [loadFeeDigests, loadTopVolumeDigestList, loadStakeDigestList] as const;
  for (let offset = 0; offset < loaders.length; offset += 1) {
    const slot = (Math.abs(rotation) + offset) % loaders.length;
    const events = await loaders[slot]!();
    if (events.length > 0) return events;
  }
  return [];
}
async function loadTopVolumeDigestList(): Promise<ArLiveFeedEvent[]> {
  const top = await loadTopVolumeDigest();
  return top ? [top] : [];
}
async function loadStakeDigestList(): Promise<ArLiveFeedEvent[]> {
  const stake = await loadStakeDigest();
  return stake ? [stake] : [];
}
async function loadFeeDigests(): Promise<ArLiveFeedEvent[]> {
  const network = getAgentLaunchNetwork();
  const dayKey = utcDayKey();
  const [todayAgg, weekAgg] = await Promise.all([
    prisma.agentLaunchFeeDistribution.aggregate({
      where: { network, createdAt: { gte: startOfUtcDay() } },
      _sum: { creatorAmount: true },
    }),
    prisma.agentLaunchFeeDistribution.aggregate({
      where: { network, createdAt: { gte: startOfUtcWeek() } },
      _sum: { creatorAmount: true },
    }),
  ]);
  const events: ArLiveFeedEvent[] = [];
  const today = buildFeesDigestFeedEvent({
    window: "today",
    creatorLamports: todayAgg._sum.creatorAmount ?? BigInt(0),
    dayKey,
  });
  const week = buildFeesDigestFeedEvent({
    window: "week",
    creatorLamports: weekAgg._sum.creatorAmount ?? BigInt(0),
    dayKey,
  });
  // Prefer week when today is empty; otherwise today first.
  if (today) events.push(today);
  else if (week) events.push(week);
  return events.slice(0, 1);
}
async function loadTopVolumeDigest(): Promise<ArLiveFeedEvent | null> {
  const network = getAgentLaunchNetwork();
  const launches = await prisma.agentLaunch.findMany({
    where: {
      network,
      launchStatus: "indexed",
      feeSharingStatus: "active",
      mint: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      mint: true,
      tokenSymbol: true,
      tokenName: true,
      profileDisplayName: true,
    },
  });
  const mints = launches.map((row) => row.mint).filter((mint): mint is string => Boolean(mint));
  if (mints.length === 0) return null;
  const markets = await getDexscreenerMarketsForMints(mints);
  let best:
    | {
        mint: string;
        volume24hUsd: number;
        tokenSymbol: string | null;
        tokenName: string | null;
      }
    | null = null;
  for (const launch of launches) {
    if (!launch.mint) continue;
    const volume = markets.get(launch.mint)?.volume24hUsd ?? 0;
    if (!Number.isFinite(volume) || volume <= 0) continue;
    if (!best || volume > best.volume24hUsd) {
      best = {
        mint: launch.mint,
        volume24hUsd: volume,
        tokenSymbol: launch.tokenSymbol,
        tokenName: launch.profileDisplayName ?? launch.tokenName,
      };
    }
  }
  if (!best) return null;
  return buildTopVolumeDigestFeedEvent({
    dayKey: utcDayKey(),
    mint: best.mint,
    tokenSymbol: best.tokenSymbol,
    tokenName: best.tokenName,
    volume24hUsd: best.volume24hUsd,
  });
}
async function loadStakeDigest(): Promise<ArLiveFeedEvent | null> {
  try {
    const payload = await readArTokenMetricsPayload();
    const staked = payload.totals?.stakedSupplyToken ?? 0;
    const label = formatTokenCompact(staked);
    if (!label) return null;
    return buildStakeDigestFeedEvent({
      dayKey: utcDayKey(),
      stakedLabel: label,
    });
  } catch {
    return null;
  }
}
