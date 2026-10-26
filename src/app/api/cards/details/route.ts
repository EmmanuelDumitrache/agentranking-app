/**
 * Card details reveal — returns live PAN/CVV from Kripicard when available.
 */
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { getCardDetails } from "@/lib/agent-payments/services/card-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readCardId(request: Request): string | undefined {
  const fromQuery = new URL(request.url).searchParams.get("cardId");
  return fromQuery ?? undefined;
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;
  const cardId = readCardId(request);
  try {
    const details = await getCardDetails(auth.appAccountId, cardId);
    return NextResponse.json(details);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Details unavailable" },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  let cardId = readCardId(request);
  if (!cardId) {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.cardId === "string") cardId = body.cardId;
    } catch {
      /* optional body */
    }
  }

  try {
    const details = await getCardDetails(auth.appAccountId, cardId);
    return NextResponse.json(details);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Details unavailable" },
      { status: 400 },
    );
  }
}
