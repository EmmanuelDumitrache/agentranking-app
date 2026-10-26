import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { toArTokenEventView } from "@/lib/ar-token-metrics";
const STAKING_TYPES = ["staking_deposit", "staking_withdrawal", "staking_reward"] as const;
const STAKING_TYPE_SET = new Set<string>(STAKING_TYPES);
export const dynamic = "force-dynamic";
async function requireAdmin() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
function parsePageParams(request: NextRequest) {
  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("page") || "1", 10) || 1);
  const pageSizeRaw = Number.parseInt(request.nextUrl.searchParams.get("pageSize") || "25", 10);
  const pageSize = Math.min(100, Math.max(1, Number.isFinite(pageSizeRaw) ? pageSizeRaw : 25));
  return { page, pageSize, skip: (page - 1) * pageSize };
}
/**
 * GET /api/admin/ar-token/staking — paginated staking metric events (admin).
 * Query: `page`, `pageSize` (max 100), optional `eventType` (one of staking_deposit | staking_withdrawal | staking_reward).
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  try {
    const { page, pageSize, skip } = parsePageParams(request);
    const typeFilter = request.nextUrl.searchParams.get("eventType")?.trim() ?? "";
    const where =
      typeFilter && STAKING_TYPE_SET.has(typeFilter) ? { eventType: typeFilter } : { eventType: { in: [...STAKING_TYPES] } };
    const [total, rows] = await Promise.all([
      prisma.arTokenMetricEvent.count({ where }),
      prisma.arTokenMetricEvent.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      }),
    ]);
    return NextResponse.json({
      total,
      page,
      pageSize,
      events: rows.map((row) => toArTokenEventView(row)),
    });
  } catch (err) {
    console.error("[admin/ar-token/staking] GET error:", err);
    return NextResponse.json({ error: "Failed to load staking events" }, { status: 500 });
  }
}