import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import {
  AgentCardApiError,
  createAgentCardSpendRequest,
  getAgentCardIdentityUrl,
  getAgentCardReadiness,
  isAgentCardConfigured,
} from "@/lib/agent-trading/agentcard";
import { getAgentCardConfig } from "@/lib/agent-trading/agentcard/config";
import { validateAgentCardAmountDollars } from "@/lib/agent-trading/agentcard/policy";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  amountDollars: z.number().positive(),
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

  const amountCheck = validateAgentCardAmountDollars(body.amountDollars);
  if (!amountCheck.ok) {
    return NextResponse.json({ error: amountCheck.message }, { status: 400 });
  }

  try {
    const readiness = await getAgentCardReadiness();
    if (!readiness.spendReady) {
      return NextResponse.json(
        {
          error:
            readiness.messages.join(" ") || "AgentCard is not ready to spend.",
          identityUrl: readiness.identityUrl,
        },
        { status: 409 },
      );
    }

    const issued = await createAgentCardSpendRequest(amountCheck.amountCents);
    if (
      !issued.pan ||
      !issued.cvv ||
      issued.expiryMonth == null ||
      issued.expiryYear == null
    ) {
      return NextResponse.json(
        { error: "Card issued but credentials were not returned." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      sensitive: true,
      id: issued.id,
      amountDollars: issued.amountCents / 100,
      status: issued.status,
      expiresAt: issued.expiresAt,
      card: {
        pan: issued.pan,
        cvv: issued.cvv,
        expiryMonth: issued.expiryMonth,
        expiryYear: issued.expiryYear,
        expiry: `${String(issued.expiryMonth).padStart(2, "0")}/${String(issued.expiryYear).slice(-2)}`,
        last4: issued.last4 ?? issued.pan.slice(-4),
        zip: issued.zip ?? null,
        cardholderName: issued.cardholderName ?? "Alchemy Agentcard",
        billingAddress:
          issued.billingAddress ?? "77 Geary St, San Francisco, CA, 94108, US",
      },
    });
  } catch (error) {
    if (
      error instanceof AgentCardApiError &&
      error.code === "identity_verification_required"
    ) {
      const config = getAgentCardConfig();
      return NextResponse.json(
        {
          error: "KYC verification required before issuing cards.",
          identityUrl: config.apiToken
            ? getAgentCardIdentityUrl(config.apiToken)
            : null,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to issue card",
      },
      { status: 502 },
    );
  }
}
