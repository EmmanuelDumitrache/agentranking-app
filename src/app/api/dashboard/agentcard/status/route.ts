import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import {
  getAgentCardReadiness,
  isAgentCardConfigured,
  listAgentCardPurchases,
} from "@/lib/agent-trading/agentcard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  if (!isAgentCardConfigured()) {
    return NextResponse.json({
      configured: false,
      message: "Set AGENTCARD_API_TOKEN to enable live virtual cards.",
    });
  }

  try {
    const readiness = await getAgentCardReadiness();
    const purchases = await listAgentCardPurchases();
    const recent = purchases
      .filter((p) => p.kind === "issued_card")
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        amountDollars: p.amountCents / 100,
        status: p.status,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
        last4: p.last4 ?? null,
        merchant: p.merchant?.name ?? null,
        canReveal: p.status === "ready" || p.status === "issued",
      }));

    const activeRequest =
      recent.find((r) => r.canReveal) ?? recent[0] ?? null;

    return NextResponse.json({
      configured: true,
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
      activeRequest,
      recentRequests: recent,
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load AgentCard status",
      },
      { status: 502 },
    );
  }
}
