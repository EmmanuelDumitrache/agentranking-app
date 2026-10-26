import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import {
  unfreezeCard,
  CardPinInvalidError,
  CardPinRequiredError,
  CardReconciliationRequiredError,
} from "@/lib/agent-payments/services/card-service";
import { formatTreasuryMutationError } from "@/lib/agent-payments/api-errors";

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
    /* optional body */
  }
  const cardId = typeof body.cardId === "string" ? body.cardId : undefined;
  const pin = typeof body.pin === "string" ? body.pin : undefined;

  try {
    const card = await unfreezeCard(auth.appAccountId, cardId, pin);
    return NextResponse.json({ card });
  } catch (err) {
    if (err instanceof CardPinRequiredError || err instanceof CardPinInvalidError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err instanceof CardPinInvalidError ? 403 : 401 },
      );
    }
    if (err instanceof CardReconciliationRequiredError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: formatTreasuryMutationError(err, "Unfreeze failed") },
      { status: 400 },
    );
  }
}
