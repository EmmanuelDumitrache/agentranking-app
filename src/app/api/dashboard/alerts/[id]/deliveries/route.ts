import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireDashboardFeatureForApi } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { agentAlertMigrationResponse } from "@/lib/agent-alert-db-error";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, { params }: Props) {
  const session = await getServerSession(authOptions);
  const dashboardAccess = await requireDashboardFeatureForApi(session, "alerts");
  if (!dashboardAccess.ok) {
    return NextResponse.json(
      { error: dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required" },
      { status: dashboardAccess.status },
    );
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) return NextResponse.json({ error: "No profile" }, { status: 400 });
  const { id } = await params;
  const ruleId = Number.parseInt(id, 10);
  if (!Number.isFinite(ruleId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const rule = await prisma.agentAlertRule.findFirst({
      where: { id: ruleId, userProfileId: profile.id },
      select: { id: true },
    });
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const deliveries = await prisma.agentAlertDelivery.findMany({
      where: { ruleId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        event: {
          select: {
            id: true,
            agentId: true,
            eventType: true,
            payload: true,
            occurredAt: true,
          },
        },
      },
    });
    return NextResponse.json({
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        status: delivery.status,
        attempts: delivery.attempts,
        lastHttpStatus: delivery.lastHttpStatus,
        lastError: delivery.lastError,
        responsePreview: delivery.responsePreview,
        deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
        createdAt: delivery.createdAt.toISOString(),
        updatedAt: delivery.updatedAt.toISOString(),
        event: {
          id: delivery.event.id,
          agentId: delivery.event.agentId,
          eventType: delivery.event.eventType,
          payload: delivery.event.payload,
          occurredAt: delivery.event.occurredAt.toISOString(),
        },
      })),
    });
  } catch (err) {
    const mig = agentAlertMigrationResponse(err);
    if (mig) return mig;
    throw err;
  }
}
