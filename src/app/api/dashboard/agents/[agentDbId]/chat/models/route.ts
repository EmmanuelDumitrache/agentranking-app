import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAgentChatAccess } from "@/features/agent-chat/server/access";
import { loadClientModelOptions } from "@/features/agent-chat/server/dashboard-bootstrap";
import { routeError } from "@/features/agent-chat/server/http";
import { agentDbIdSchema } from "@/features/agent-chat/shared/schemas";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  try {
    const agentId = agentDbIdSchema.parse((await params).agentDbId);
    const access = await getAgentChatAccess(await getServerSession(authOptions), agentId, {
      allowDisabled: true,
    });
    return NextResponse.json(await loadClientModelOptions(access.appAccountId));
  } catch (error) {
    return routeError(error);
  }
}
