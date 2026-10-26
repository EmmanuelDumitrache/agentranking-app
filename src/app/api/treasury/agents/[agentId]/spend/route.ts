import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { requestAgentSpend } from "@/lib/agent-payments/services/spend-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ agentId: string }> };

export async function POST(request: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  const { agentId: id } = await params;
  const agentId = Number(id);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const amountCents = Number(record.amountCents);

  try {
    const result = await requestAgentSpend({
      appAccountId: auth.appAccountId,
      agentId,
      amountCents,
      merchant: String(record.merchant ?? ""),
      category: String(record.category ?? ""),
      reason: String(record.reason ?? ""),
      idempotencyKey:
        typeof record.idempotencyKey === "string" ? record.idempotencyKey : undefined,
    });

    if ("rejected" in result && result.rejected) {
      return NextResponse.json(
        { rejected: true, reasons: result.reasons },
        { status: 403 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Spend failed" },
      { status: 400 },
    );
  }
}
