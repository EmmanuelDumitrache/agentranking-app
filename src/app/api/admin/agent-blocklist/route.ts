import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/admin-auth";
import { readAdminAgentBlocklist } from "@/lib/admin/operations/agent-blocklist.server";
import { isAdminOperationsReadError, isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { AGENT_BLOCKLIST_PRISMA_STALE, getAgentBlocklistRuleDelegate } from "@/lib/agent-blocklist";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
export const dynamic = "force-dynamic";
const MATCH_TYPES = [
  "name_contains",
  "name_exact",
  "uri_contains",
  "uri_exact",
  "owner_wallet",
  "agent_key",
] as const;
const CreateSchema = z.object({
  matchType: z.enum(MATCH_TYPES),
  value: z.string().min(1).max(2000),
  note: z.string().max(2000).optional().default(""),
  active: z.boolean().optional().default(true),
});
export async function GET() {
  try {
    return NextResponse.json(await readAdminAgentBlocklist());
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isAdminOperationsReadError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("GET /api/admin/agent-blocklist error:", error);
    return NextResponse.json({ error: "Failed to load blocklist" }, { status: 500 });
  }
}
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 422 });
  }
  const bl = getAgentBlocklistRuleDelegate();
  if (!bl) {
    return NextResponse.json({ error: AGENT_BLOCKLIST_PRISMA_STALE }, { status: 503 });
  }
  const rule = await bl.create({
    data: {
      matchType: parsed.data.matchType,
      value: parsed.data.value.trim(),
      note: parsed.data.note ?? "",
      active: parsed.data.active ?? true,
    },
  });
  await invalidateAllPublicStatistics();
  return NextResponse.json({ rule }, { status: 201 });
}
