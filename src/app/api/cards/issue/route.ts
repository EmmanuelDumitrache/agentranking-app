import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import {
  CardIssuancePaymentRequiredError,
  issueCard,
} from "@/lib/agent-payments/services/card-service";

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

  const agentIdRaw = body.agentId != null ? Number(body.agentId) : null;
  const agentId =
    agentIdRaw != null && Number.isInteger(agentIdRaw) && agentIdRaw > 0
      ? agentIdRaw
      : null;

  const displayName = typeof body.displayName === "string" ? body.displayName : undefined;
  const amountUsd = body.amountUsd != null ? Number(body.amountUsd) : undefined;
  const bin = typeof body.bin === "string" ? body.bin.trim() : undefined;
  const email = typeof body.email === "string" ? body.email : undefined;
  const dateOfBirth = typeof body.dateOfBirth === "string" ? body.dateOfBirth : undefined;
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;

  if (!bin) {
    return NextResponse.json({ error: "Select a card location (BIN)" }, { status: 400 });
  }
  if (amountUsd == null || !Number.isFinite(amountUsd) || amountUsd < 10) {
    return NextResponse.json({ error: "amountUsd must be at least 10" }, { status: 400 });
  }

  try {
    const result = await issueCard({
      appAccountId: auth.appAccountId,
      agentId,
      displayName,
      amountUsd,
      bin,
      email,
      dateOfBirth,
      idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CardIssuancePaymentRequiredError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          feeCents: err.feeCents,
          availableCents: err.availableCents,
        },
        { status: 402 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Card issuance failed" },
      { status: 400 },
    );
  }
}
