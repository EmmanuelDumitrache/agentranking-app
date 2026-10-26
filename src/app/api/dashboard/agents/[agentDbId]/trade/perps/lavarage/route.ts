import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { getLavaraveConfig } from "@/lib/agent-trading/lavarave/config";
import {
  loadLavaraveOffers,
  loadLavaraveOpenPositions,
  openLavaraveLongPosition,
  resolveAgentWalletForLavarage,
  sellLavaravePosition,
} from "@/lib/agent-trading/lavarave/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

function parseAgentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
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

  const config = getLavaraveConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Lavarage API key is not configured" }, { status: 503 });
  }

  const wallet = await resolveAgentWalletForLavarage(id);
  if (!wallet.ok) {
    return NextResponse.json({ error: wallet.message }, { status: 400 });
  }

  try {
    const [offers, positions] = await Promise.all([
      loadLavaraveOffers(),
      loadLavaraveOpenPositions(wallet.walletPk),
    ]);
    return NextResponse.json({ offers, positions, walletPk: wallet.walletPk });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lavarage fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
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

  const config = getLavaraveConfig();
  if (!config.enabled) {
    return NextResponse.json({ error: "Lavarage API key is not configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    action?: "open" | "sell";
    symbol?: string;
    amountSol?: number;
    leverageX?: number;
    slippagePct?: number;
    positionId?: string;
  };

  if (body.action === "open") {
    if (!body.symbol?.trim()) {
      return NextResponse.json({ error: "symbol (token mint) is required" }, { status: 400 });
    }
    const amountSol = body.amountSol ?? 0;
    const leverageX = body.leverageX ?? 1;
    const slippagePct = body.slippagePct ?? 10;
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return NextResponse.json({ error: "amountSol must be > 0" }, { status: 400 });
    }
    if (!Number.isFinite(leverageX) || leverageX < 1) {
      return NextResponse.json({ error: "leverageX must be >= 1" }, { status: 400 });
    }

    const result = await openLavaraveLongPosition({
      agentDbId: id,
      symbol: body.symbol.trim(),
      amountSol,
      leverageX,
      slippagePct,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, txid: result.txid });
  }

  if (body.action === "sell") {
    if (!body.positionId?.trim()) {
      return NextResponse.json({ error: "positionId is required" }, { status: 400 });
    }
    const result = await sellLavaravePosition({
      agentDbId: id,
      positionId: body.positionId.trim(),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, txid: result.txid });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
