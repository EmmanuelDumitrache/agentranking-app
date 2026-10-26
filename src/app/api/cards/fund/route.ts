import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { fundAgentArCardFromTreasury } from "@/lib/agent-payments/services/agent-kripicard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const amountCents =
    body.amountCents != null
      ? Number(body.amountCents)
      : Math.round(Number(body.amountUsd) * 100);

  if (!Number.isInteger(amountCents) || amountCents < 1000) {
    return NextResponse.json({ error: "Minimum top-up is $10" }, { status: 400 });
  }

  const cardId = typeof body.cardId === "string" ? body.cardId : undefined;

  try {
    const result = await fundAgentArCardFromTreasury({
      appAccountId: auth.appAccountId,
      cardId,
      amountCents,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
    });
    return NextResponse.json({
      ok: true,
      card: result.card,
      balanceUsd: result.balanceUsd,
      feeUsd: result.funded.data?.fee ?? null,
      message: `Loaded $${(amountCents / 100).toFixed(2)} onto AR card.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Top-up failed";
    const status = message.includes("Insufficient") ? 402 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
