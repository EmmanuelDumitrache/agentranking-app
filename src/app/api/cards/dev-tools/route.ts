import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { isCardDevToolsActive } from "@/lib/agent-payments/config";
import {
  devCancelAccountCard,
  devGenerateRandomCard,
  devSimulateCardPayment,
} from "@/lib/agent-payments/services/card-dev-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DevToolsAction = "generate" | "cancel" | "simulate-spend";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isCardDevToolsActive(session.user?.email)) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  const accountEmail = session.user?.email ?? null;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action as DevToolsAction | undefined;
  if (!action || !["generate", "cancel", "simulate-spend"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const cardId = typeof body.cardId === "string" ? body.cardId : undefined;
  const agentIdRaw = body.agentId != null ? Number(body.agentId) : null;
  const agentId =
    agentIdRaw != null && Number.isInteger(agentIdRaw) && agentIdRaw > 0
      ? agentIdRaw
      : undefined;
  const amountCentsRaw = body.amountCents != null ? Number(body.amountCents) : undefined;
  const amountCents =
    amountCentsRaw != null && Number.isInteger(amountCentsRaw) && amountCentsRaw > 0
      ? amountCentsRaw
      : undefined;
  const merchant = typeof body.merchant === "string" ? body.merchant : undefined;
  const category = typeof body.category === "string" ? body.category : undefined;

  try {
    if (action === "generate") {
      const result = await devGenerateRandomCard(
        auth.appAccountId,
        agentId ?? null,
        accountEmail,
      );
      return NextResponse.json(result);
    }

    if (action === "cancel") {
      const result = await devCancelAccountCard(
        auth.appAccountId,
        cardId,
        accountEmail,
      );
      return NextResponse.json(result);
    }

    const result = await devSimulateCardPayment(
      {
        appAccountId: auth.appAccountId,
        cardId,
        agentId: agentId ?? null,
        amountCents,
        merchant,
        category,
      },
      accountEmail,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dev tools action failed" },
      { status: 400 },
    );
  }
}
