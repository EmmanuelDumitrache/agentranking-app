import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { runScheduleNow } from "@/lib/agent-schedule/execute-run";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ agentDbId: string; scheduleId: string }>;
};

function parseAgentId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function POST(_request: Request, context: RouteContext) {
  const { agentDbId, scheduleId } = await context.params;
  const id = parseAgentId(agentDbId);
  if (id == null) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await assertDashboardAgentAccess(session, id);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await runScheduleNow(id, scheduleId);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: result.reason,
        error: result.errorMessage ?? result.reason,
      },
      { status: result.reason === "schedule_not_found" ? 404 : 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    runId: result.runId,
    conversationId: result.conversationId,
    outputSummary: result.outputSummary,
    costCents: result.costCents,
  });
}
