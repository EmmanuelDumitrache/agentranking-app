import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
export type AdminAgentMcpRow = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
};
export async function requireAdminAgentForMcp(
  agentDbId: number,
): Promise<{ ok: true; agent: AdminAgentMcpRow } | { ok: false; response: NextResponse }> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      isVerified: true,
      isPremiumVerified: true,
    },
  });
  if (!agent) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { ok: true, agent };
}