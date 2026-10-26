import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
import {
  getAgentCardReadiness,
  isAgentCardConfigured,
  listAgentCardPurchases,
} from "@/lib/agent-trading/agentcard";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentDbId: string }> };

function parseAgentId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  return NextResponse.json(body, { ...init, headers });
}

export async function GET(_request: Request, context: RouteContext) {
  const { agentDbId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return jsonNoStore({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    const error =
      access.status === 401
        ? "Unauthorized"
        : access.status === 403
          ? "Forbidden"
          : "Agent not found";
    return jsonNoStore({ error }, { status: access.status });
  }

  if (!isAgentCardConfigured()) {
    return jsonNoStore({
      configured: false,
      message: "AgentCard is not enabled on this deployment.",
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
      }));

    return jsonNoStore({
      configured: true,
      readiness: {
        spendReady: readiness.spendReady,
        paymentMethodReady: readiness.paymentMethodReady,
        agentEmailReady: readiness.agentEmailReady,
        walletReady: readiness.walletReady,
        identityStatus: readiness.identityStatus,
        identityRequired: readiness.identityRequired,
        identityUrl: readiness.identityUrl,
        email: readiness.email,
        agentEmail: readiness.agentEmail,
        messages: readiness.messages,
        limits: readiness.limits
          ? {
              spendLimitDollars: readiness.limits.spendLimitCents / 100,
              spentDollars: readiness.limits.spentCents / 100,
              remainingDollars: readiness.limits.remainingCents / 100,
            }
          : null,
      },
      recentRequests: recent,
    });
  } catch (error) {
    console.error("[agentcard] status fetch failed", {
      agentDbId: id,
      error: safeErrorDetails(error),
    });
    return jsonNoStore(
      { configured: true, error: "Failed to load AgentCard status" },
      { status: 502 },
    );
  }
}
