import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAgentChatAccess } from "@/features/agent-chat/server/access";
import { getRun } from "@/features/agent-chat/server/repositories/runs";
import { HttpError, routeError } from "@/features/agent-chat/server/http";
import {
  agentDbIdSchema,
  entityIdSchema,
} from "@/features/agent-chat/shared/schemas";
import type { AgentChatRunSummary } from "@/features/agent-chat/shared/contracts";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentDbId: string; runId: string }> },
) {
  try {
    const values = await params;
    const agentId = agentDbIdSchema.parse(values.agentDbId);
    const runId = entityIdSchema.parse(values.runId);
    const access = await getAgentChatAccess(
      await getServerSession(authOptions),
      agentId,
      { allowDisabled: true },
    );
    const run = await getRun(access, runId);
    if (!run) throw new HttpError(404, "RUN_NOT_FOUND", "Run not found");
    const response: AgentChatRunSummary = {
      id: run.id,
      status: run.status,
      settlementStatus: run.settlementStatus,
      modelKey: run.finalModelKey ?? run.initialModelKey,
      reservedCents: run.reservedCents,
      finalChargeCents: run.finalChargeCents,
      refundCents: run.refundCents,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    };
    return NextResponse.json(response);
  } catch (error) {
    return routeError(error);
  }
}