import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { confirmFunding, createFundingIntent } from "@/lib/agent-payments/services/funding-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const action = String(record.action ?? "create").trim();

  try {
    if (action === "confirm") {
      const intentId = String(record.intentId ?? "").trim();
      if (!intentId) {
        return NextResponse.json({ error: "intentId is required" }, { status: 400 });
      }
      const intent = await confirmFunding({
        appAccountId: auth.appAccountId,
        intentId,
      });
      return NextResponse.json({ intent });
    }

    const amountCents = Number(record.amountCents);
    if (!Number.isInteger(amountCents) || amountCents < 1000) {
      return NextResponse.json(
        { error: "amountCents must be an integer >= 1000 ($10 minimum)" },
        { status: 400 },
      );
    }
    const origin = new URL(request.url).origin;
    const returnUrl =
      String(record.returnUrl ?? "").trim() || `${origin}/dashboard/card`;

    const intent = await createFundingIntent({
      appAccountId: auth.appAccountId,
      amountCents,
      returnUrl,
      idempotencyKey: typeof record.idempotencyKey === "string" ? record.idempotencyKey : undefined,
    });

    // Demo / mock: auto-confirm so the UI works without real crypto.
    if (
      (intent.providerName === "mock" || record.demoFlow === true) &&
      record.autoConfirm !== false &&
      intent.providerIntentId
    ) {
      const confirmed = await confirmFunding({
        appAccountId: auth.appAccountId,
        intentId: intent.id,
      });
      return NextResponse.json({ intent: confirmed, autoConfirmed: true });
    }

    return NextResponse.json({ intent });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Funding failed" },
      { status: 400 },
    );
  }
}
