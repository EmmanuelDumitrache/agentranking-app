import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { adminCreateCreatorAgent } from "@/lib/admin-creator-mutations";
export const dynamic = "force-dynamic";
/**
 * POST /api/admin/creators/[id]/agents
 * Admin-create a native AgentRanking agent for this creator (bypasses maxAgents).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: { name?: string; description?: string; image?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = await adminCreateCreatorAgent(id, {
    name: body.name ?? "",
    description: body.description,
    image: body.image,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ agent: result.agent, creator: result.creator });
}