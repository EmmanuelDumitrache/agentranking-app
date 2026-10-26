import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { executeAgentTrade } from "@/lib/agent-trading/execute-trade";
import type { JupiterQuote } from "@/lib/agent-trading/jupiter-client";
import type { TradeSide } from "@/lib/agent-trading/constants";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

function parseAgentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function solscanTxUrl(sig: string, isDevnet: boolean): string {
  const base = `https://solscan.io/tx/${sig}`;
  return isDevnet ? `${base}?cluster=devnet` : base;
}

export async function POST(request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await getDashboardAccess(session);
  if (!access.ownedAgents.some((agent) => agent.id === id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    side?: TradeSide;
    tokenMint?: string;
    quote?: JupiterQuote;
    tokenSymbol?: string | null;
    tokenName?: string | null;
  };

  if (body.side !== "buy" && body.side !== "sell") {
    return NextResponse.json({ error: "side must be buy or sell" }, { status: 400 });
  }
  if (!body.tokenMint?.trim() || !body.quote) {
    return NextResponse.json({ error: "tokenMint and quote are required" }, { status: 400 });
  }

  const result = await executeAgentTrade({
    agentDbId: id,
    actorProfileId:
      typeof session?.user?.profileId === "number" ? session.user.profileId : undefined,
    side: body.side,
    tokenMint: body.tokenMint.trim(),
    quote: body.quote,
    tokenSymbol: body.tokenSymbol,
    tokenName: body.tokenName,
  });

  if (!result.ok) {
    const status = result.code === "wallet_unavailable" ? 400 : 502;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  const isDevnet = process.env.AGENT_LAUNCH_NETWORK === "devnet";
  return NextResponse.json({
    ok: true,
    signature: result.signature,
    tradeId: result.tradeId,
    solscanUrl: solscanTxUrl(result.signature, isDevnet),
  });
}
