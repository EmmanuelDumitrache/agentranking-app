import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
import {
  getAgentCardPurchase,
  getAgentCardSpendRequest,
  isAgentCardConfigured,
} from "@/lib/agent-trading/agentcard";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  requestId: z.string().min(1),
});

type RouteContext = { params: Promise<{ agentDbId: string }> };

function parseAgentId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  return NextResponse.json(body, { ...init, headers });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginMutation(request);
  } catch {
    return jsonNoStore({ error: "Cross-origin request denied" }, { status: 403 });
  }

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
    return jsonNoStore(
      { error: "AgentCard is not configured" },
      { status: 503 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return jsonNoStore({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const purchase = await getAgentCardPurchase(body.requestId);
    if (purchase.kind !== "issued_card") {
      return jsonNoStore(
        { error: "Only issued single-use cards can be revealed." },
        { status: 400 },
      );
    }
    if (purchase.status !== "ready" && purchase.status !== "issued") {
      return jsonNoStore(
        {
          error: `Card is ${purchase.status}. Credentials are only available for live unused cards.`,
        },
        { status: 409 },
      );
    }

    const req = await getAgentCardSpendRequest(purchase.id, true);
    if (!req.pan || !req.cvv || req.expiryMonth == null || req.expiryYear == null) {
      return jsonNoStore(
        { error: "Card credentials are no longer available." },
        { status: 410 },
      );
    }

    return jsonNoStore({
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
        zip: req.zip ?? null,
        cardholderName: req.cardholderName ?? "Alchemy Agentcard",
        billingAddress:
          req.billingAddress ?? "77 Geary St, San Francisco, CA, 94108, US",
      },
      message:
        "Shown once in this session. Not stored in chat history or the database.",
    });
  } catch (error) {
    console.error("[agentcard] credential reveal failed", {
      agentDbId: id,
      error: safeErrorDetails(error),
    });
    return jsonNoStore(
      { error: "Failed to reveal card credentials" },
      { status: 502 },
    );
  }
}
