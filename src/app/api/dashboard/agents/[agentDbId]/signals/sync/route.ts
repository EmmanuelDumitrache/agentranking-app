import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { enqueueAgentSignalSync } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
export const dynamic = "force-dynamic";
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  if (!Number.isFinite(agentDbId)) {
    return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  }
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  }
  const jobId = await enqueueAgentSignalSync(agentDbId);
  return NextResponse.json(
    {
      accepted: true,
      queue: JOB_QUEUES.AGENT_SIGNALS_SYNC,
      jobId,
      deduplicated: jobId == null,
    },
    { status: 202 },
  );
}
