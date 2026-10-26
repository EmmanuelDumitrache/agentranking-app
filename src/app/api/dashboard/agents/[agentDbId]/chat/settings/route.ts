import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAgentChatAccess } from "@/features/agent-chat/server/access";
import { parseJsonBody, routeError } from "@/features/agent-chat/server/http";
import {
  agentDbIdSchema,
  updateSettingsSchema,
} from "@/features/agent-chat/shared/schemas";
import { createAgentChatSettingsRevision } from "@/features/agent-chat/server/repositories/settings";
export const dynamic = "force-dynamic";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  try {
    const agentId = agentDbIdSchema.parse((await params).agentDbId);
    const access = await getAgentChatAccess(
      await getServerSession(authOptions),
      agentId,
      { allowDisabled: true },
    );
    return NextResponse.json(access.settings);
  } catch (error) {
    return routeError(error);
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  try {
    const agentId = agentDbIdSchema.parse((await params).agentDbId);
    const body = await parseJsonBody(request, updateSettingsSchema, 16_384);
    const access = await getAgentChatAccess(
      await getServerSession(authOptions),
      agentId,
      { allowDisabled: true },
    );
    const updated = await createAgentChatSettingsRevision(access, body);
    return NextResponse.json(updated);
  } catch (error) {
    return routeError(error);
  }
}