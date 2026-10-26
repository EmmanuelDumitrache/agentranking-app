import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string; configId: string }> };

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

export async function PATCH(request: Request, context: RouteContext) {
  const { agentDbId, configId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await prisma.agentCopyTradeConfig.findFirst({
    where: { id: configId, agentDbId: id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    status?: string;
    label?: string | null;
    targetWallet?: string;
    buyPercent?: number;
    sellPercent?: number;
    sizingMode?: string;
    portfolioAllocationPct?: number;
    maxPositionUsd?: number | null;
    loopCadenceSec?: number;
    llmModelKey?: string | null;
    llmBudgetUsd?: number | null;
  };

  const data: {
    status?: string;
    label?: string | null;
    targetWallet?: string;
    buyPercent?: number;
    sellPercent?: number;
    sizingMode?: string;
    portfolioAllocationPct?: number;
    maxPositionUsd?: number | null;
    loopCadenceSec?: number;
    llmModelKey?: string | null;
    llmBudgetUsd?: number | null;
  } = {};

  if (body.status === "active" || body.status === "paused") {
    data.status = body.status;
  }
  if (body.label !== undefined) {
    data.label = body.label?.trim() || null;
  }
  if (body.targetWallet !== undefined) {
    const targetWallet = body.targetWallet.trim();
    if (!SOLANA_ADDRESS_RE.test(targetWallet)) {
      return NextResponse.json({ error: "Invalid Solana wallet address" }, { status: 400 });
    }
    data.targetWallet = targetWallet;
  }
  if (body.buyPercent != null) {
    if (!Number.isInteger(body.buyPercent) || body.buyPercent < 1 || body.buyPercent > 100) {
      return NextResponse.json({ error: "buyPercent must be 1–100" }, { status: 400 });
    }
    data.buyPercent = body.buyPercent;
  }
  if (body.sellPercent != null) {
    if (!Number.isInteger(body.sellPercent) || body.sellPercent < 1 || body.sellPercent > 100) {
      return NextResponse.json({ error: "sellPercent must be 1–100" }, { status: 400 });
    }
    data.sellPercent = body.sellPercent;
  }
  if (body.portfolioAllocationPct != null) {
    if (
      !Number.isInteger(body.portfolioAllocationPct)
      || body.portfolioAllocationPct < 1
      || body.portfolioAllocationPct > 100
    ) {
      return NextResponse.json({ error: "portfolioAllocationPct must be 1–100" }, { status: 400 });
    }
    data.portfolioAllocationPct = body.portfolioAllocationPct;
  }
  if (body.loopCadenceSec != null) {
    if (
      !Number.isInteger(body.loopCadenceSec)
      || body.loopCadenceSec < 5
      || body.loopCadenceSec > 3600
    ) {
      return NextResponse.json({ error: "loopCadenceSec must be 5–3600" }, { status: 400 });
    }
    data.loopCadenceSec = body.loopCadenceSec;
  }
  if (body.sizingMode !== undefined) {
    data.sizingMode =
      body.sizingMode === "fixed_usd" || body.sizingMode === "multiplier"
        ? body.sizingMode
        : "proportional";
  }
  if (body.maxPositionUsd !== undefined) {
    data.maxPositionUsd = body.maxPositionUsd;
  }
  if (body.llmModelKey !== undefined) {
    data.llmModelKey = body.llmModelKey?.trim() || null;
  }
  if (body.llmBudgetUsd !== undefined) {
    data.llmBudgetUsd = body.llmBudgetUsd;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const updated = await prisma.agentCopyTradeConfig.update({
    where: { id: configId },
    data,
  });

  return NextResponse.json({ config: mapConfig(updated) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { agentDbId, configId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await prisma.agentCopyTradeConfig.findFirst({
    where: { id: configId, agentDbId: id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.agentCopyTradeConfig.delete({ where: { id: configId } });
  return NextResponse.json({ ok: true });
}
