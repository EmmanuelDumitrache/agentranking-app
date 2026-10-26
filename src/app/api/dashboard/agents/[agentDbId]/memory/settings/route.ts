import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAgentMemoryAccess } from "@/features/agent-memory/server/access";
import { updateAgentMemorySettings } from "@/features/agent-memory/server/repository";
import { updateMemorySettingsSchema } from "@/features/agent-memory/shared/schemas";
import { agentDbIdSchema } from "@/features/agent-chat/shared/schemas";
import { parseJsonBody, routeError } from "@/features/agent-chat/server/http";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  try {
    const agentId = agentDbIdSchema.parse((await params).agentDbId);
    const access = await getAgentMemoryAccess(await getServerSession(authOptions), agentId);
    const body = await parseJsonBody(request, updateMemorySettingsSchema, 4_096);
    const settings = await updateAgentMemorySettings(
      prisma,
      agentId,
      access.appAccountId,
      body,
    );
    return NextResponse.json({ settings });
  } catch (error) {
    return routeError(error);
  }
}
