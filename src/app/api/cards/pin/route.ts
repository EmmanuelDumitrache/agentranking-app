import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import {
  removeCardFreezePin,
  setCardFreezePin,
} from "@/lib/agent-payments/services/card-pin-service";
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
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const cardId = typeof body.cardId === "string" ? body.cardId : "";
  const action = typeof body.action === "string" ? body.action : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  const confirmPin = typeof body.confirmPin === "string" ? body.confirmPin : "";

  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }

  try {
    if (action === "set") {
      const card = await setCardFreezePin({
        appAccountId: auth.appAccountId,
        cardId,
        pin,
        confirmPin,
      });
      return NextResponse.json({ ok: true, card: { id: card.id, pinSet: true } });
    }

    if (action === "remove") {
      const card = await removeCardFreezePin({
        appAccountId: auth.appAccountId,
        cardId,
        pin,
      });
      return NextResponse.json({ ok: true, card: { id: card.id, pinSet: false } });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = formatTreasuryMutationError(err, "Could not update freeze PIN");
    const status = message.includes("Incorrect") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
