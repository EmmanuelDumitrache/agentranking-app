import { NextRequest, NextResponse } from "next/server";
import { getPartnerJobDetail } from "@/lib/jobs/get-partner-job-detail";
export const dynamic = "force-dynamic";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await getPartnerJobDetail(id);
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      job: result.job,
      matchedAgents: result.matchedAgents,
    });
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    console.error("GET /api/jobs/[id]:", msg);
    return NextResponse.json({ error: "Failed to load job" }, { status: 500 });
  }
}
