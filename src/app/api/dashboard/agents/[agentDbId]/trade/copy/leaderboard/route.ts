import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { loadPerpsoSpotLeaderboardPage } from "@/lib/agent-trading/perpso/client";
import { PERPSO_LEADERBOARD_PAGE_SIZE, perpsoWalletProfileUrl } from "@/lib/agent-trading/perpso/urls";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

function parseAgentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(value, max);
}

export async function GET(request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet")?.trim() ?? "";
  const limit = parsePositiveInt(url.searchParams.get("limit"), PERPSO_LEADERBOARD_PAGE_SIZE, 50);
  const offset = parsePositiveInt(url.searchParams.get("offset"), 0, 10_000);

  try {
    if (wallet) {
      if (!SOLANA_ADDRESS_RE.test(wallet)) {
        return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
      }
      const spot = await loadPerpsoSpotLeaderboardPage(500, 0);
      const match = spot.traders.find((row) => row.wallet === wallet);
      if (match) {
        return NextResponse.json({ trader: match });
      }
      return NextResponse.json({
        trader: {
          rank: 0,
          wallet,
          label: null,
          pnlUsd: 0,
          winRate: 0,
          volumeUsd: 0,
          trades: 0,
          venue: "spot" as const,
          chain: "solana" as const,
          topAssetSymbol: "SOL",
          profileUrl: perpsoWalletProfileUrl(wallet),
        },
      });
    }

    const page = await loadPerpsoSpotLeaderboardPage(limit, offset);
    return NextResponse.json({ ...page, source: "perp.so" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Leaderboard failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
