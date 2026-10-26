import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sanitizeForPostgres } from "@/lib/utils";
import { requireDashboardFeatureForApi } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
import { agentAlertMigrationResponse } from "@/lib/agent-alert-db-error";
import { validateWebhookUrl } from "@/lib/webhook-url";
export const dynamic = "force-dynamic";
function parseEventTypes(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return ["agent.event"];
  const out = [...new Set(v
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().slice(0, 100))
    .filter(Boolean))].slice(0, 32);
  return out.length ? out : ["agent.event"];
}
function serializeRule(r: {
  id: number;
  userProfileId: number;
  agentId: number | null;
  webhookUrl: string;
  secret: string | null;
  eventTypes: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  agent: { name: string } | null;
}) {
  return {
    id: r.id,
    agentId: r.agentId,
    agentName: r.agent?.name ?? null,
    webhookUrl: r.webhookUrl,
    hasSecret: Boolean(r.secret?.trim()),
    eventTypes: r.eventTypes,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
async function loadRuleForProfile(ruleId: number, userProfileId: number) {
  return prisma.agentAlertRule.findFirst({
    where: { id: ruleId, userProfileId },
    include: { agent: { select: { name: true } } },
  });
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const dashboardAccess = await requireDashboardFeatureForApi(session, "alerts");
  if (!dashboardAccess.ok) {
    return NextResponse.json(
      { error: dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required" },
      { status: dashboardAccess.status },
    );
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "No profile" }, { status: 400 });
  }
  const { id } = await params;
  const ruleId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(ruleId) || ruleId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const existing = await loadRuleForProfile(ruleId, profile.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ownershipWallet =
    profile.walletAddress?.trim() ||
    profile.solanaWallet?.trim() ||
    session?.user?.walletAddress?.trim() ||
    null;
  let body: {
    webhookUrl?: string;
    agentId?: number | null;
    secret?: string | null;
    eventTypes?: unknown;
    isActive?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  if (body.webhookUrl !== undefined) {
    const webhookUrl = sanitizeForPostgres(String(body.webhookUrl).trim().slice(0, 2000));
    if (!webhookUrl || !validateWebhookUrl(webhookUrl).ok) {
      return NextResponse.json(
        { error: "webhookUrl must be a public HTTPS URL. Local HTTP requires ALLOW_LOCAL_WEBHOOKS=1 outside production." },
        { status: 400 },
      );
    }
    data.webhookUrl = webhookUrl;
  }
  if (body.agentId !== undefined) {
    if (body.agentId === null) {
      data.agentId = null;
    } else {
      const aid = Number(body.agentId);
      if (!Number.isSafeInteger(aid) || aid <= 0) {
        return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
      }
      const owned = await dashboardUserOwnsAgentDbId(ownershipWallet, aid, profile.id);
      if (!owned) return NextResponse.json({ error: "Forbidden or unknown agent." }, { status: 403 });
      data.agentId = aid;
    }
  }
  if (body.secret !== undefined) {
    const secretRaw = sanitizeForPostgres(String(body.secret ?? "").trim().slice(0, 512));
    data.secret = secretRaw ? secretRaw : null;
  }
  const et = parseEventTypes(body.eventTypes);
  if (et !== undefined) data.eventTypes = et;
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ rule: serializeRule(existing) });
  }
  try {
    const updated = await prisma.agentAlertRule.update({
      where: { id: ruleId },
      data,
      include: { agent: { select: { name: true } } },
    });
    return NextResponse.json({ rule: serializeRule(updated) });
  } catch (err) {
    const mig = agentAlertMigrationResponse(err);
    if (mig) return mig;
    throw err;
  }
}
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const dashboardAccess = await requireDashboardFeatureForApi(session, "alerts");
  if (!dashboardAccess.ok) {
    return NextResponse.json(
      { error: dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required" },
      { status: dashboardAccess.status },
    );
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "No profile" }, { status: 400 });
  }
  const { id } = await params;
  const ruleId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(ruleId) || ruleId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const existing = await loadRuleForProfile(ruleId, profile.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await prisma.agentAlertRule.delete({ where: { id: ruleId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const mig = agentAlertMigrationResponse(err);
    if (mig) return mig;
    throw err;
  }
}
