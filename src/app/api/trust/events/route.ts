import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const agentId = Number(searchParams.get("agentId"));
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const pageSize = 50;
    if (!agentId || isNaN(agentId)) {
      return NextResponse.json({ error: "agentId is required" }, { status: 422 });
    }
    const [events, total] = await Promise.all([
      prisma.trustEvent.findMany({
        where: { agentId },
        orderBy: { timestamp: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.trustEvent.count({ where: { agentId } }),
    ]);
    return NextResponse.json({ events, total, page, pageSize }, {
      headers: { "Cache-Control": "public, s-maxage=30" },
    });
  } catch (err) {
    console.error("[GET /api/trust/events]", err);
    return NextResponse.json({ error: "Failed to fetch trust events" }, { status: 500 });
  }
}