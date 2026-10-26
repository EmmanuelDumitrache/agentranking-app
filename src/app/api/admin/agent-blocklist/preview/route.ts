import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { whereAgentMatchesRule } from "@/lib/agent-blocklist";
export const dynamic = "force-dynamic";
const MATCH_TYPES = [
  "name_contains",
  "name_exact",
  "uri_contains",
  "uri_exact",
  "owner_wallet",
  "agent_key",
] as const;
const BodySchema = z.object({
  matchType: z.enum(MATCH_TYPES),
  value: z.string().min(1).max(2000),
});
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 422 });
  }
  const tempRule = {
    id: "preview",
    matchType: parsed.data.matchType,
    value: parsed.data.value.trim(),
    active: true,
  };
  const agentWhere = whereAgentMatchesRule(tempRule);
  if (!agentWhere) {
    return NextResponse.json({ count: 0, error: "Rule does not match any valid filter (check agent_key format: chainId:agentId)." });
  }
  const count = await prisma.agent.count({ where: agentWhere });
  return NextResponse.json({ count });
}