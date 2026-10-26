import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth-session";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      agentIds: number[];
      workReadyStatus?: string;
      featuredWorkReady?: boolean;
    };
    if (!Array.isArray(body.agentIds) || body.agentIds.length === 0) {
      return NextResponse.json({ error: "agentIds required" }, { status: 400 });
    }
    const data: {
      workReadyStatus?: string;
      featuredWorkReady?: boolean;
      workReadyUpdatedAt?: Date;
    } = { workReadyUpdatedAt: new Date() };
    if (typeof body.workReadyStatus === "string") {
      const status = body.workReadyStatus.trim().toLowerCase();
      if (!["none", "pending", "approved"].includes(status)) {
        return NextResponse.json({ error: "Invalid workReadyStatus" }, { status: 400 });
      }
      data.workReadyStatus = status;
    }
    if (typeof body.featuredWorkReady === "boolean") {
      data.featuredWorkReady = body.featuredWorkReady;
    }
    const result = await prisma.agent.updateMany({
      where: { id: { in: body.agentIds } },
      data,
    });
    return NextResponse.json({ ok: true, updated: result.count });
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
