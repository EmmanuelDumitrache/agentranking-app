import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
const PatchSchema = z.object({
  status: z.enum(["open", "reviewed", "dismissed"]).optional(),
  adminNotes: z.string().max(4000).optional(),
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
  const existing = await prisma.agentReport.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const data: { status?: string; adminNotes?: string } = {};
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.adminNotes !== undefined) data.adminNotes = parsed.data.adminNotes;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No changes" }, { status: 400 });
  }
  const updated = await prisma.agentReport.update({
    where: { id },
    data,
    include: {
      agent: { select: { id: true, name: true, chainId: true, agentId: true } },
    },
  });
  return NextResponse.json({ report: updated });
}