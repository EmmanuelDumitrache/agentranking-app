import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/admin-auth";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { whereAgentMatchesRule } from "@/lib/agent-blocklist";
import { deleteAgentsMatching } from "@/lib/delete-agent-records";
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
  confirm: z.literal("DELETE_MATCHING_AGENTS"),
});
/**
 * Hard-deletes Agent rows matching the rule shape and refreshes affected chain counts.
 */
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
    return NextResponse.json(
      {
        error: "Invalid payload",
        issues: parsed.error.issues,
        hint: 'confirm must be exactly "DELETE_MATCHING_AGENTS"',
      },
      { status: 422 }
    );
  }
  const tempRule = {
    id: "purge",
    matchType: parsed.data.matchType,
    value: parsed.data.value.trim(),
    active: true,
  };
  const agentWhere = whereAgentMatchesRule(tempRule);
  if (!agentWhere) {
    return NextResponse.json({ deleted: 0, error: "No valid match filter (check agent_key format: chainId:agentId)." });
  }
  const deleted = await deleteAgentsMatching(agentWhere);
  await invalidateAllPublicStatistics();
  return NextResponse.json({ deleted });
}
