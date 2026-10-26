import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAgentMemoryAccess } from "@/features/agent-memory/server/access";
import {
  AgentMemoryConflictError,
  createAgentMemoryFact,
  readAgentMemoryPageData,
} from "@/features/agent-memory/server/repository";
import { createMemoryFactSchema } from "@/features/agent-memory/shared/schemas";
import { agentDbIdSchema } from "@/features/agent-chat/shared/schemas";
import { parseJsonBody, routeError } from "@/features/agent-chat/server/http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  try {
    const agentId = agentDbIdSchema.parse((await params).agentDbId);
    const access = await getAgentMemoryAccess(await getServerSession(authOptions), agentId);
    return NextResponse.json(await readAgentMemoryPageData(prisma, agentId, access.appAccountId), {
      headers: { "Cache-Control": "private, no-store" },
    });
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
    const access = await getAgentMemoryAccess(await getServerSession(authOptions), agentId);
    const body = await parseJsonBody(request, createMemoryFactSchema, 8_192);
    const result = await createAgentMemoryFact(prisma, {
      agentDbId: agentId,
      appAccountId: access.appAccountId,
      kind: body.kind,
      content: body.content,
      status: "active",
      pinned: body.pinned,
      confidence: 1,
      reviveInactive: true,
    });
    if (!result.fact) {
      return NextResponse.json(
        { error: "Could not add memory." },
        { status: 409 },
      );
    }
    return NextResponse.json({
      fact: result.fact,
      created: result.created,
      revived: result.revived,
    });
  } catch (error) {
    if (error instanceof AgentMemoryConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return routeError(error);
  }
}
