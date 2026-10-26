import "server-only";
import type { CopyLeaderboardTrader } from "@/lib/agent-trading/copy-trade/types";

const TOP_WALLETS_URL =
  "https://raw.githubusercontent.com/wallets-alpha/top-wallets/main/top-wallets.csv";

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

type TopWalletRow = {
  wallet: string;
  rank: number;
  roi_7d: number;
  roi_30d: number;
  win_rate: number;
  pnl_usd: number;
  trades: number;
};

let cachedAt = 0;
let cachedWallets: TopWalletRow[] = [];

function parseCsvLine(line: string, headers: string[]): Record<string, string> | null {
  const values = line.split(",");
  if (values.length < headers.length) return null;
  const row: Record<string, string> = {};
  headers.forEach((header, index) => {
    row[header] = values[index]?.trim() ?? "";
  });
  return row;
}

async function fetchTopWallets(): Promise<TopWalletRow[]> {
  if (Date.now() - cachedAt < CACHE_TTL_MS && cachedWallets.length > 0) {
    return cachedWallets;
  }
  const res = await fetch(TOP_WALLETS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Top wallets CSV failed (${res.status})`);
  const csv = await res.text();
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",").map((h) => h.trim());
  const wallets = lines
    .slice(1)
    .map((line, index) => {
      const row = parseCsvLine(line, headers);
      if (!row?.wallet) return null;
      const winRate = Number.parseFloat(row.Winrate ?? row.winrate ?? "0") || 0;
      const trades = Number.parseInt(row.Total_Tokens ?? row.Tokens_Count_30d ?? row.trades ?? "0", 10) || 0;
      if (winRate <= 50 || trades <= 10) return null;
      return {
        wallet: row.wallet,
        rank: index + 1,
        roi_7d: Number.parseFloat(row.ROI_7d ?? "0") || 0,
        roi_30d: Number.parseFloat(row.ROI_30d ?? "0") || 0,
        win_rate: winRate,
        pnl_usd: Number.parseFloat(row.Realized_Gains ?? row.pnl_usd ?? "0") || 0,
        trades,
      };
    })
    .filter((row): row is TopWalletRow => row != null)
    .sort((a, b) => b.roi_30d - a.roi_30d);

  cachedAt = Date.now();
  cachedWallets = wallets;
  return wallets;
}

export async function loadSpotCopyLeaderboard(
  limit = 24,
): Promise<CopyLeaderboardTrader[]> {
  const wallets = await fetchTopWallets();
  return wallets.slice(0, limit).map((wallet, index) => ({
    rank: index + 1,
    wallet: wallet.wallet,
    label: null,
    pnlUsd: wallet.pnl_usd,
    winRate: wallet.win_rate,
    volumeUsd: 0,
    trades: wallet.trades,
    venue: "spot" as const,
    chain: "solana" as const,
    topAssetSymbol: "SOL",
  }));
}

export async function searchSpotTrader(wallet: string): Promise<CopyLeaderboardTrader | null> {
  const wallets = await fetchTopWallets();
  const match = wallets.find((row) => row.wallet === wallet);
  if (!match) return null;
  return {
    rank: match.rank,
    wallet: match.wallet,
    label: null,
    pnlUsd: match.pnl_usd,
    winRate: match.win_rate,
    volumeUsd: 0,
    trades: match.trades,
    venue: "spot",
    chain: "solana",
    topAssetSymbol: "SOL",
  };
}
