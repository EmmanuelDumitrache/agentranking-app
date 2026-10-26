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
function parseEventTypes(v: unknown): string[] {
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
export async function GET() {
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
  try {
    const rules = await prisma.agentAlertRule.findMany({
      where: { userProfileId: profile.id },
      orderBy: { createdAt: "desc" },
      include: { agent: { select: { name: true } } },
    });
    return NextResponse.json({ rules: rules.map(serializeRule) });
  } catch (err) {
    const mig = agentAlertMigrationResponse(err);
    if (mig) return mig;
    throw err;
  }
}
export async function POST(request: NextRequest) {
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
  const webhookUrl = sanitizeForPostgres(String(body.webhookUrl ?? "").trim().slice(0, 2000));
  if (!webhookUrl || !validateWebhookUrl(webhookUrl).ok) {
    return NextResponse.json(
      { error: "webhookUrl must be a public HTTPS URL. Local HTTP requires ALLOW_LOCAL_WEBHOOKS=1 outside production." },
      { status: 400 },
    );
  }
  let agentId: number | null = null;
  const rawAgentId = body.agentId;
  if (rawAgentId !== undefined && rawAgentId !== null) {
    const aid = Number(rawAgentId);
    if (!Number.isSafeInteger(aid) || aid <= 0) {
      return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
    }
    const owned = await dashboardUserOwnsAgentDbId(ownershipWallet, aid, profile.id);
    if (!owned) return NextResponse.json({ error: "Forbidden or unknown agent." }, { status: 403 });
    agentId = aid;
  }
  const secretRaw = body.secret != null
    ? sanitizeForPostgres(String(body.secret).trim().slice(0, 512))
    : "";
  const secret = secretRaw ? secretRaw : null;
  const eventTypes = parseEventTypes(body.eventTypes);
  const isActive = body.isActive !== false;
  try {
    const created = await prisma.agentAlertRule.create({
      data: {
        userProfileId: profile.id,
        agentId,
        webhookUrl,
        secret,
        eventTypes,
        isActive,
      },
      include: { agent: { select: { name: true } } },
    });
    return NextResponse.json({ rule: serializeRule(created) });
  } catch (err) {
    const mig = agentAlertMigrationResponse(err);
    if (mig) return mig;
    throw err;
  }
}
