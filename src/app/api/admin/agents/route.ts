import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
/**
 * GET /api/admin/agents?search=...
 * Admin-only search for verified agents (for Add Promotion form).
 * Returns: { id, name, chainId, agentId, isVerified, image }
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() ?? "";
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "20", 10) || 20,
      50
    );
    if (!search || search.length < 2) {
      return NextResponse.json({ agents: [] });
    }
    const isNumeric = /^\d+$/.test(search) && !Number.isNaN(parseInt(search, 10));
    const where: Prisma.AgentWhereInput = {
      isVerified: true,
      isActive: true,
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ],
    };
    if (isNumeric) {
      (where.OR as Prisma.AgentWhereInput[]).push({
        agentId: parseInt(search, 10),
      });
    }
    const agents = await prisma.agent.findMany({
      where,
      include: { chain: true },
      orderBy: { score: "desc" },
      take: limit,
    });
    return NextResponse.json({
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        chainId: a.chainId,
        agentId: a.agentId,
        isVerified: a.isVerified,
        image: a.image,
        chain: a.chain ? { id: a.chain.id, name: a.chain.name } : null,
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/agents error:", err);
    return NextResponse.json(
      { error: "Failed to search agents" },
      { status: 500 }
    );
  }
}