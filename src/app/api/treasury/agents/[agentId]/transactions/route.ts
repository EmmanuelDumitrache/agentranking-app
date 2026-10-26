import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { getAgentSpendSummary } from "@/lib/agent-payments/services/agent-service";
import { listTransactions } from "@/lib/agent-payments/services/transaction-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ agentId: string }> };

export async function GET(request: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  const { agentId: id } = await params;
  const agentId = Number(id);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const summary = await getAgentSpendSummary(auth.appAccountId, agentId);
  if (!summary) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const transactions = await listTransactions({
    appAccountId: auth.appAccountId,
    agentId,
    limit: url.searchParams.get("limit")
      ? Number(url.searchParams.get("limit"))
      : 50,
  });

  return NextResponse.json({ summary, transactions });
}
