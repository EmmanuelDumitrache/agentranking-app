import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAgentChatAccess } from "@/features/agent-chat/server/access";
import { createConversation, listConversations } from "@/features/agent-chat/server/repositories/conversations";
import { parseJsonBody, routeError } from "@/features/agent-chat/server/http";
import {
  agentDbIdSchema,
  conversationListQuerySchema,
  createConversationSchema,
} from "@/features/agent-chat/shared/schemas";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  try {
    const agentId = agentDbIdSchema.parse((await params).agentDbId);
    const query = conversationListQuerySchema.parse({
      cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    const access = await getAgentChatAccess(
      await getServerSession(authOptions),
      agentId,
      { allowDisabled: true },
    );
    return NextResponse.json(
      await listConversations(access, query.cursor, query.limit),
    );
  } catch (error) {
    return routeError(error);
  }
}
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  try {
    const agentId = agentDbIdSchema.parse((await params).agentDbId);
    const body = await parseJsonBody(request, createConversationSchema, 8_192);
    const access = await getAgentChatAccess(
      await getServerSession(authOptions),
      agentId,
    );
    return NextResponse.json(await createConversation(access, body), { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
