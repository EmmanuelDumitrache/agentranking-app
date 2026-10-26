import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/admin-auth";
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
const PatchSchema = z.object({
  matchType: z.enum(MATCH_TYPES).optional(),
  value: z.string().min(1).max(2000).optional(),
  note: z.string().max(2000).optional(),
  active: z.boolean().optional(),
});
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 422 });
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.matchType !== undefined) data.matchType = parsed.data.matchType;
  if (parsed.data.value !== undefined) data.value = parsed.data.value.trim();
  if (parsed.data.note !== undefined) data.note = parsed.data.note;
  if (parsed.data.active !== undefined) data.active = parsed.data.active;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }
  const bl = getAgentBlocklistRuleDelegate();
  if (!bl) {
    return NextResponse.json({ error: AGENT_BLOCKLIST_PRISMA_STALE }, { status: 503 });
  }
  try {
    const rule = await bl.update({
      where: { id },
      data,
    });
    await invalidateAllPublicStatistics();
    return NextResponse.json({ rule });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
