import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import {
  getAgentCardReadiness,
  getAgentCardSpendRequest,
  isAgentCardConfigured,
  listAgentCardPurchases,
} from "@/lib/agent-trading/agentcard";

export const dynamic = "force-dynamic";

function mapLiveCard(
  req: Awaited<ReturnType<typeof getAgentCardSpendRequest>>,
  amountDollars: number,
) {
  if (!req.pan || !req.cvv || req.expiryMonth == null || req.expiryYear == null) {
    return null;
  }
  return {
    sensitive: true as const,
    id: req.id,
    amountDollars,
    status: req.status,
    expiresAt: req.expiresAt,
    pan: req.pan,
    cvv: req.cvv,
    expiryMonth: req.expiryMonth,
    expiryYear: req.expiryYear,
    expiry: `${String(req.expiryMonth).padStart(2, "0")}/${String(req.expiryYear).slice(-2)}`,
    last4: req.last4 ?? req.pan.slice(-4),
    cardholderName: req.cardholderName ?? "AgentRanking",
  };
}

/** Single call: status + auto-reveal active live card credentials for the dashboard UI. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  if (!isAgentCardConfigured()) {
    return NextResponse.json({
      configured: false,
      card: null,
      message:
        "Run `agentcard signup` then restart dev, or set AGENTCARD_API_TOKEN in .env.local",
    });
  }

  try {
    const readiness = await getAgentCardReadiness();
    const purchases = await listAgentCardPurchases();
    const issued = purchases.filter((p) => p.kind === "issued_card");
    const active =
      issued.find(
        (p) => p.status === "ready" || p.status === "issued",
      ) ?? null;

    let card = null;
    if (active) {
      try {
        const req = await getAgentCardSpendRequest(active.id, true);
        card = mapLiveCard(req, active.amountCents / 100);
      } catch {
        /* active card may have expired credentials */
      }
    }

    return NextResponse.json({
      configured: true,
      card,
      activeRequest: active
        ? {
            id: active.id,
            amountDollars: active.amountCents / 100,
            status: active.status,
            last4: active.last4 ?? null,
            expiresAt: active.expiresAt,
            canReveal: active.status === "ready" || active.status === "issued",
          }
        : null,
      readiness: {
        spendReady: readiness.spendReady,
        identityRequired: readiness.identityRequired,
        identityUrl: readiness.identityUrl,
        messages: readiness.messages,
        limits: readiness.limits
          ? {
              spendLimitDollars: readiness.limits.spendLimitCents / 100,
              spentDollars: readiness.limits.spentCents / 100,
              remainingDollars: readiness.limits.remainingCents / 100,
            }
          : null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        card: null,
        error:
          error instanceof Error ? error.message : "Failed to load virtual card",
      },
      { status: 502 },
    );
  }
}
