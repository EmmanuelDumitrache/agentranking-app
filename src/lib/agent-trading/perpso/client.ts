import "server-only";

import type { CopyLeaderboardTrader } from "@/lib/agent-trading/copy-trade/types";
import { PERPSO_BASE_URL, PERPSO_LEADERBOARD_PAGE_SIZE, perpsoWalletProfileUrl } from "@/lib/agent-trading/perpso/urls";

const SOL_ECOSYSTEM_SYMBOLS = new Set(["SOL", "JitoSOL", "mSOL", "bSOL", "JupSOL", "WSOL"]);

type PerpsoSpotRow = {
  wallet: string;
  trades?: number;
  volumeUsd?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  totalPnl?: number;
  winRate?: number | null;
  pnlSpark?: number[];
  topAsset?: { symbol?: string; icon?: string };
  topAssets?: string[];
  periods?: Record<string, { pnl?: number; volume?: number; trades?: number; winRate?: number | null }>;
};

type PerpsoSpotLeaderboardResponse = {
  ok?: boolean;
  rows?: PerpsoSpotRow[];
};

async function perpsoFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${PERPSO_BASE_URL}${path}`, {
    headers: { accept: "application/json" },
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`perp.so request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function spotPnl30d(row: PerpsoSpotRow): number {
  return row.periods?.["30d"]?.pnl ?? row.totalPnl ?? row.realizedPnl ?? 0;
}

function spotIsSolFocused(row: PerpsoSpotRow): boolean {
  const topSymbol = row.topAsset?.symbol;
  return Boolean(topSymbol && SOL_ECOSYSTEM_SYMBOLS.has(topSymbol));
}

function spotWinRate30d(row: PerpsoSpotRow): number {
  const rate = row.periods?.["30d"]?.winRate ?? row.winRate;
  return typeof rate === "number" && Number.isFinite(rate) ? rate : 0;
}

function spotTrades30d(row: PerpsoSpotRow): number {
  return row.periods?.["30d"]?.trades ?? row.trades ?? 0;
}

/** Balanced score: high win rate only ranks well with enough trades + real PnL. */
function spotLeaderboardScore(row: PerpsoSpotRow): number {
  const winRate = spotWinRate30d(row);
  const trades = spotTrades30d(row);
  const pnl = spotPnl30d(row);
  const confidence = 1 - Math.exp(-trades / 40);
  const adjustedWinRate = winRate * confidence;
  const activity = Math.log10(trades + 1) * 12;
  const profit = Math.log10(Math.max(pnl, 1)) * 8;
  return adjustedWinRate + activity + profit;
}

function spotQualifiesForLeaderboard(row: PerpsoSpotRow): boolean {
  if (!row.wallet || !spotIsSolFocused(row)) return false;

  const pnl = spotPnl30d(row);
  const trades = spotTrades30d(row);
  const winRate = spotWinRate30d(row);

  if (pnl <= 0 || trades < 10) return false;
  if (winRate >= 95 && trades < 40) return false;
  if (winRate >= 85 && trades < 20) return false;

  return true;
}

let sortedSpotRowsCache: { at: number; rows: PerpsoSpotRow[] } | null = null;
const SORTED_SPOT_CACHE_MS = 5 * 60 * 1000;

async function getSortedSpotLeaderboardRows(): Promise<PerpsoSpotRow[]> {
  if (sortedSpotRowsCache && Date.now() - sortedSpotRowsCache.at < SORTED_SPOT_CACHE_MS) {
    return sortedSpotRowsCache.rows;
  }

  const payload = await perpsoFetch<PerpsoSpotLeaderboardResponse>("/api/spot/leaderboard");
  const rows = (payload.rows ?? [])
    .filter(spotQualifiesForLeaderboard)
    .sort((a, b) => spotLeaderboardScore(b) - spotLeaderboardScore(a));

  sortedSpotRowsCache = { at: Date.now(), rows };
  return rows;
}

export type PerpsoSpotLeaderboardPage = {
  traders: CopyLeaderboardTrader[];
  total: number;
  hasMore: boolean;
};

export async function loadPerpsoSpotLeaderboardPage(
  limit = PERPSO_LEADERBOARD_PAGE_SIZE,
  offset = 0,
): Promise<PerpsoSpotLeaderboardPage> {
  const rows = await getSortedSpotLeaderboardRows();
  const page = rows.slice(offset, offset + limit);

  return {
    traders: page.map((row, index) => mapSpotRow(row, offset + index + 1)),
    total: rows.length,
    hasMore: offset + limit < rows.length,
  };
}

function mapSpotRow(row: PerpsoSpotRow, rank: number): CopyLeaderboardTrader {
  const pnlUsd = spotPnl30d(row);
  const sparkline = (row.pnlSpark ?? []).filter((value) => Number.isFinite(value));
  const topSymbol = row.topAsset?.symbol;
  return {
    rank,
    wallet: row.wallet,
    label: topSymbol ? `${topSymbol} trader` : null,
    pnlUsd,
    winRate: row.periods?.["30d"]?.winRate ?? row.winRate ?? 0,
    volumeUsd: row.periods?.["30d"]?.volume ?? row.volumeUsd ?? 0,
    trades: row.periods?.["30d"]?.trades ?? row.trades ?? 0,
    venue: "spot",
    chain: "solana",
    topAssetSymbol: topSymbol,
    topAssetIcon: row.topAsset?.icon,
    profileUrl: perpsoWalletProfileUrl(row.wallet),
    pnlSparkline: sparkline.length >= 2 ? sparkline : undefined,
  };
}

/** Profitable SOL-focused spot traders from [perp.so](https://perp.so) spot leaderboard. */
export async function loadPerpsoSpotLeaderboard(
  limit = PERPSO_LEADERBOARD_PAGE_SIZE,
): Promise<CopyLeaderboardTrader[]> {
  const page = await loadPerpsoSpotLeaderboardPage(limit, 0);
  return page.traders;
}
