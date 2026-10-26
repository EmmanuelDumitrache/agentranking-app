import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

function parseAgentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function mapConfig(row: {
  id: string;
  label: string | null;
  targetWallet: string;
  venue: string;
  status: string;
  buyMode: string;
  buyPercent: number;
  buySolAmount: number | null;
  sellPercent: number;
  maxBuySol: number | null;
  sizingMode: string;
  portfolioAllocationPct: number;
  maxPositionUsd: number | null;
  leverage: number;
  loopCadenceSec: number;
  llmModelKey: string | null;
  llmBudgetUsd: number | null;
  mirrorCount: number;
  lastMirroredAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    label: row.label,
    targetWallet: row.targetWallet,
    venue: row.venue,
    status: row.status,
    buyMode: row.buyMode,
    buyPercent: row.buyPercent,
    buySolAmount: row.buySolAmount,
    sellPercent: row.sellPercent,
    maxBuySol: row.maxBuySol,
    sizingMode: row.sizingMode,
    portfolioAllocationPct: row.portfolioAllocationPct,
    maxPositionUsd: row.maxPositionUsd,
    leverage: row.leverage,
    loopCadenceSec: row.loopCadenceSec,
    llmModelKey: row.llmModelKey,
    llmBudgetUsd: row.llmBudgetUsd,
    mirrorCount: row.mirrorCount,
    lastMirroredAt: row.lastMirroredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(_request: Request, context: RouteContext) {
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

  const configs = await prisma.agentCopyTradeConfig.findMany({
    where: { agentDbId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ configs: configs.map(mapConfig) });
}

export async function POST(request: Request, context: RouteContext) {
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

  const body = (await request.json()) as {
    targetWallet?: string;
    label?: string | null;
    venue?: string;
    buyPercent?: number;
    buyMode?: string;
    buySolAmount?: number | null;
    sellPercent?: number;
    maxBuySol?: number | null;
    sizingMode?: string;
    portfolioAllocationPct?: number;
    maxPositionUsd?: number | null;
    leverage?: number;
    loopCadenceSec?: number;
    llmModelKey?: string | null;
    llmBudgetUsd?: number | null;
  };

  const targetWallet = body.targetWallet?.trim() ?? "";
  if (!SOLANA_ADDRESS_RE.test(targetWallet)) {
    return NextResponse.json({ error: "Invalid Solana wallet address" }, { status: 400 });
  }

  const buyPercent = body.buyPercent ?? 25;
  if (!Number.isInteger(buyPercent) || buyPercent < 1 || buyPercent > 100) {
    return NextResponse.json({ error: "buyPercent must be 1–100" }, { status: 400 });
  }

  const sellPercent = body.sellPercent ?? 100;
  if (!Number.isInteger(sellPercent) || sellPercent < 1 || sellPercent > 100) {
    return NextResponse.json({ error: "sellPercent must be 1–100" }, { status: 400 });
  }

  const portfolioAllocationPct = body.portfolioAllocationPct ?? 100;
  if (
    !Number.isInteger(portfolioAllocationPct)
    || portfolioAllocationPct < 1
    || portfolioAllocationPct > 100
  ) {
    return NextResponse.json({ error: "portfolioAllocationPct must be 1–100" }, { status: 400 });
  }

  const loopCadenceSec = body.loopCadenceSec ?? 10;
  if (!Number.isInteger(loopCadenceSec) || loopCadenceSec < 5 || loopCadenceSec > 3600) {
    return NextResponse.json({ error: "loopCadenceSec must be 5–3600" }, { status: 400 });
  }

  const sizingMode =
    body.sizingMode === "fixed_usd" || body.sizingMode === "multiplier"
      ? body.sizingMode
      : "proportional";

  const buyMode = body.buyMode === "sol" ? "sol" : "percentage";
  if (buyMode === "sol" && (body.buySolAmount == null || body.buySolAmount <= 0)) {
    return NextResponse.json({ error: "buySolAmount required for sol mode" }, { status: 400 });
  }

  // Spot-only for now — leverage / lavarave copy is not implemented.
  const venue = "spot";
  const leverage = 1;

  try {
    const created = await prisma.agentCopyTradeConfig.create({
      data: {
        agentDbId: id,
        targetWallet,
        venue,
        label: body.label?.trim() || null,
        buyMode,
        buyPercent,
        buySolAmount: buyMode === "sol" ? body.buySolAmount : null,
        sellPercent,
        maxBuySol: body.maxBuySol ?? null,
        sizingMode,
        portfolioAllocationPct,
        maxPositionUsd: body.maxPositionUsd ?? null,
        leverage,
        loopCadenceSec,
        llmModelKey: body.llmModelKey?.trim() || null,
        llmBudgetUsd: body.llmBudgetUsd ?? null,
        status: "active",
      },
    });

    return NextResponse.json({ config: mapConfig(created) }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create copy trade config";
    console.error("[copy-trade] create failed:", message);
    return NextResponse.json(
      {
        error: message.includes("Unknown argument")
          ? "Copy trade schema mismatch. Run prisma generate and reload."
          : "Failed to create copy trade subscription",
      },
      { status: 500 },
    );
  }
}
