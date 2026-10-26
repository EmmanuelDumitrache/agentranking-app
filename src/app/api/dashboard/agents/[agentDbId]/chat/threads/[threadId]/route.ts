import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAgentChatAccess } from "@/features/agent-chat/server/access";
import {
  getConversation,
  renameConversation,
  softDeleteConversation,
  updateConversationStatus,
} from "@/features/agent-chat/server/repositories/conversations";
import { loadConversationDetail } from "@/features/agent-chat/server/dashboard-bootstrap";
import { requestAbort } from "@/features/agent-chat/server/run/abort-registry";
import { settleRun } from "@/features/agent-chat/server/run/settle-run";
import {
  parseJsonBody,
  routeError,
} from "@/features/agent-chat/server/http";
import {
  agentDbIdSchema,
  messageListQuerySchema,
  updateConversationSchema,
  entityIdSchema,
} from "@/features/agent-chat/shared/schemas";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string; threadId: string }> },
) {
  try {
    const { agentDbId, threadId } = await params;
    const agentId = agentDbIdSchema.parse(agentDbId);
    entityIdSchema.parse(threadId);
    const query = messageListQuerySchema.parse({
      before: request.nextUrl.searchParams.get("before") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });
    const access = await getAgentChatAccess(
      await getServerSession(authOptions),
      agentId,
      { allowDisabled: true },
    );
    return NextResponse.json(
      await loadConversationDetail(access, threadId, query.before, query.limit),
    );
  } catch (error) {
    return routeError(error);
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string; threadId: string }> },
) {
  try {
    const { agentDbId, threadId } = await params;
    const agentId = agentDbIdSchema.parse(agentDbId);
    entityIdSchema.parse(threadId);
    const body = await parseJsonBody(request, updateConversationSchema, 8_192);
    const access = await getAgentChatAccess(
      await getServerSession(authOptions),
      agentId,
      { allowDisabled: true },
    );
    let conversation = body.status
      ? await updateConversationStatus(access, threadId, body.status)
      : await getConversation(access, threadId);
    if (body.title !== undefined) {
      conversation = await renameConversation(access, threadId, body.title);
    }
    return NextResponse.json(conversation);
  } catch (error) {
    return routeError(error);
  }
}
export async function DELETE(
  _request: NextRequest,
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
    // Force-stop any hung / in-flight run so delete is never blocked.
    const activeRuns = await prisma.agentChatRun.findMany({
      where: {
        conversation: {
          id: threadId,
          appAccountId: access.appAccountId,
          agentDbId: access.agentDbId,
        },
        status: { in: ["PREPARING", "RESERVED", "STREAMING"] },
      },
      select: { id: true },
      orderBy: { startedAt: "desc" },
    });
    for (const run of activeRuns) {
      requestAbort(run.id);
      try {
        await settleRun(run.id, "CANCELLED", {
            errorCode: "REQUEST_CANCELLED",
          errorMessage: "Cancelled because the conversation was deleted",
        });
      } catch {
        // Settlement can race with an in-flight stream; still delete the thread.
      }
    }
    await softDeleteConversation(access, threadId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return routeError(error);
  }
}
