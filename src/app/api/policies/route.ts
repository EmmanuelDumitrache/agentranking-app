import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import {
  getSpendingPolicy,
  updateSpendingPolicy,
} from "@/lib/agent-payments/services/spending-policy-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;
  const policy = await getSpendingPolicy(auth.appAccountId);
  return NextResponse.json({ policy });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  try {
    const policy = await updateSpendingPolicy(auth.appAccountId, {
      dailyLimitCents:
        typeof record.dailyLimitCents === "number" ? record.dailyLimitCents : undefined,
      weeklyLimitCents:
        typeof record.weeklyLimitCents === "number" ? record.weeklyLimitCents : undefined,
      monthlyLimitCents:
        typeof record.monthlyLimitCents === "number" ? record.monthlyLimitCents : undefined,
      allowedCategories: Array.isArray(record.allowedCategories)
        ? record.allowedCategories.map(String)
        : undefined,
      blockedCategories: Array.isArray(record.blockedCategories)
        ? record.blockedCategories.map(String)
        : undefined,
      allowManualUsage:
        typeof record.allowManualUsage === "boolean" ? record.allowManualUsage : undefined,
      allowAgentUsage:
        typeof record.allowAgentUsage === "boolean" ? record.allowAgentUsage : undefined,
    });
    return NextResponse.json({ policy });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Policy update failed" },
      { status: 400 },
    );
  }
}
