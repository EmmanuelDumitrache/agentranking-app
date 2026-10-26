import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod/v4";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import {
  getAgentCardPurchase,
  isAgentCardConfigured,
  listAgentCardThreeDsCodes,
} from "@/lib/agent-trading/agentcard";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";

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
    return jsonNoStore({ error: "AgentCard is not configured" }, { status: 503 });
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
        { error: "3DS codes are only available for issued single-use cards." },
        { status: 400 },
      );
    }

    const codes = await listAgentCardThreeDsCodes({ purchaseId: purchase.id });
    return jsonNoStore({
      sensitive: true,
      id: purchase.id,
      codes: codes.slice(0, 10).map((item) => ({
        code: item.code,
        match: item.match ?? null,
        merchant: item.merchant ?? null,
        amountDollars:
          typeof item.amountCents === "number" ? item.amountCents / 100 : null,
        currency: item.currency ?? null,
        reasons: item.reasons ?? [],
      })),
      message:
        codes.length === 0
          ? "No recent 3DS challenge codes are available for this card."
          : "Sensitive checkout codes are shown only in this authenticated browser session and are not sent through chat.",
    });
  } catch (error) {
    console.error("[agentcard] 3DS reveal failed", {
      agentDbId: id,
      error: safeErrorDetails(error),
    });
    return jsonNoStore({ error: "Could not retrieve 3DS challenge codes" }, { status: 502 });
  }
}
