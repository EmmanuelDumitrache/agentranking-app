import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAgentChatAccess } from "@/features/agent-chat/server/access";
import { cancelRun } from "@/features/agent-chat/server/run/cancel-run";
import { routeError } from "@/features/agent-chat/server/http";
import {
  agentDbIdSchema,
  entityIdSchema,
} from "@/features/agent-chat/shared/schemas";
export async function POST(
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
    return NextResponse.json(await cancelRun(access, runId));
  } catch (error) {
    return routeError(error);
  }
}