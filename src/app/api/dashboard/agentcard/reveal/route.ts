import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import {
  getAgentCardPurchase,
  getAgentCardSpendRequest,
  isAgentCardConfigured,
} from "@/lib/agent-trading/agentcard";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  requestId: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  if (!isAgentCardConfigured()) {
    return NextResponse.json(
      { error: "AgentCard is not configured" },
      { status: 503 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const purchase = await getAgentCardPurchase(body.requestId);
    if (purchase.kind !== "issued_card") {
      return NextResponse.json(
        { error: "Only issued single-use cards can be revealed." },
        { status: 400 },
      );
    }
    if (purchase.status !== "ready" && purchase.status !== "issued") {
      return NextResponse.json(
        {
          error: `Card is ${purchase.status}. Credentials are only available for live unused cards.`,
        },
        { status: 409 },
      );
    }

    const req = await getAgentCardSpendRequest(purchase.id, true);
    if (
      !req.pan ||
      !req.cvv ||
      req.expiryMonth == null ||
      req.expiryYear == null
    ) {
      return NextResponse.json(
        { error: "Card credentials are no longer available." },
        { status: 410 },
      );
    }

    return NextResponse.json({
      sensitive: true,
      id: req.id,
      amountDollars: req.amountCents / 100,
      status: req.status,
      expiresAt: req.expiresAt,
      card: {
        pan: req.pan,
        cvv: req.cvv,
        expiryMonth: req.expiryMonth,
        expiryYear: req.expiryYear,
        expiry: `${String(req.expiryMonth).padStart(2, "0")}/${String(req.expiryYear).slice(-2)}`,
        last4: req.last4 ?? req.pan.slice(-4),
        zip: req.zip ?? null,
        cardholderName: req.cardholderName ?? "Alchemy Agentcard",
        billingAddress:
          req.billingAddress ?? "77 Geary St, San Francisco, CA, 94108, US",
      },
      message: "Shown once in this session. Not stored server-side.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to reveal card credentials",
      },
      { status: 502 },
    );
  }
}
