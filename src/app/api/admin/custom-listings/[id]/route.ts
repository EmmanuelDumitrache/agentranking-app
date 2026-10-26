import { NextRequest, NextResponse } from "next/server";
import { invalidateAllPublicStatistics } from "@/lib/invalidate-public-statistics";
import { deleteCustomListedAgent } from "@/lib/delete-agent-records";
import { getSession } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
export async function DELETE(_request: NextRequest, { params }: Params) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const dbId = Number(id);
    if (!Number.isFinite(dbId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const result = await deleteCustomListedAgent(dbId);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (result.status === "not_custom") {
      return NextResponse.json(
        { error: "Hard delete is only allowed for custom-listed agents" },
        { status: 403 },
      );
    }
    await invalidateAllPublicStatistics();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
