import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireDashboardFeatureForApi } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { agentAlertMigrationResponse } from "@/lib/agent-alert-db-error";
import { queueAgentAlertTestDelivery } from "@/lib/agent-alert-events";
export const dynamic = "force-dynamic";
export async function POST(
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
  if (!profile) return NextResponse.json({ error: "No profile" }, { status: 400 });
  const { id } = await params;
  const ruleId = Number.parseInt(id, 10);
  if (!Number.isFinite(ruleId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const queued = await queueAgentAlertTestDelivery(ruleId, profile.id);
    if (!queued) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(
      {
        ok: true,
        queued: true,
        eventId: queued.eventId,
        deliveryId: queued.deliveryId,
      },
      { status: 202 },
    );
  } catch (err) {
    const mig = agentAlertMigrationResponse(err);
    if (mig) return mig;
    throw err;
  }
}
