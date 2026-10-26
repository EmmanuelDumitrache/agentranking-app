import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAgentChatAccess } from "@/features/agent-chat/server/access";
import { compactConversationContext } from "@/features/agent-chat/server/conversation-summary";
import { routeError } from "@/features/agent-chat/server/http";
import { getConversation } from "@/features/agent-chat/server/repositories/conversations";
import {
  agentDbIdSchema,
  entityIdSchema,
} from "@/features/agent-chat/shared/schemas";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ agentDbId: string; threadId: string }> },
) {
  try {
    const { agentDbId, threadId } = await params;
    const agentId = agentDbIdSchema.parse(agentDbId);
    entityIdSchema.parse(threadId);
    const access = await getAgentChatAccess(
      await getServerSession(authOptions),
      agentId,
      { allowDisabled: true },
    );
    await getConversation(access, threadId);
    return NextResponse.json(
      await compactConversationContext(threadId, { force: true }),
    );
  } catch (error) {
    return routeError(error);
  }
}
