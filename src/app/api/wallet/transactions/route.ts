import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { listTransactions } from "@/lib/agent-payments/services/transaction-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const agentIdRaw = url.searchParams.get("agentId");
  const agentId = agentIdRaw ? Number(agentIdRaw) : undefined;

  const result = await listTransactions({
    appAccountId: auth.appAccountId,
    agentId: Number.isInteger(agentId) ? agentId : undefined,
    merchant: url.searchParams.get("merchant") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    from: url.searchParams.get("from")
      ? new Date(url.searchParams.get("from")!)
      : undefined,
    to: url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : undefined,
    limit: url.searchParams.get("limit")
      ? Number(url.searchParams.get("limit"))
      : 50,
    offset: url.searchParams.get("offset")
      ? Number(url.searchParams.get("offset"))
      : 0,
  });

  return NextResponse.json(result);
}
