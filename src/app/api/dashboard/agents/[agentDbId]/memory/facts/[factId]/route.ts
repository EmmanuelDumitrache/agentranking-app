import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAgentMemoryAccess } from "@/features/agent-memory/server/access";
import {
  AgentMemoryConflictError,
  archiveAgentMemoryFact,
  updateAgentMemoryFact,
} from "@/features/agent-memory/server/repository";
import {
  memoryFactIdSchema,
  updateMemoryFactSchema,
} from "@/features/agent-memory/shared/schemas";
import { agentDbIdSchema } from "@/features/agent-chat/shared/schemas";
import { parseJsonBody, routeError } from "@/features/agent-chat/server/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ agentDbId: string; factId: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { agentDbId, factId: factIdRaw } = await params;
    const agentId = agentDbIdSchema.parse(agentDbId);
    const factId = memoryFactIdSchema.parse(factIdRaw);
    const access = await getAgentMemoryAccess(await getServerSession(authOptions), agentId);
    const body = await parseJsonBody(request, updateMemoryFactSchema, 8_192);
    const fact = await updateAgentMemoryFact(
      prisma,
      agentId,
      access.appAccountId,
      factId,
      body,
    );
    if (!fact) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }
    return NextResponse.json({ fact });
  } catch (error) {
    if (error instanceof AgentMemoryConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return routeError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const { agentDbId, factId: factIdRaw } = await params;
    const agentId = agentDbIdSchema.parse(agentDbId);
    const factId = memoryFactIdSchema.parse(factIdRaw);
    const access = await getAgentMemoryAccess(await getServerSession(authOptions), agentId);
    const archived = await archiveAgentMemoryFact(
      prisma,
      agentId,
      access.appAccountId,
      factId,
    );
    if (!archived) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
