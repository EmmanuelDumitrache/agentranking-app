import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { enqueueApplicationJob } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
export const dynamic = "force-dynamic";
/** POST /api/admin/metaplex/index — enqueue one Core asset for durable indexing. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as { assetAddress?: string };
    const assetAddress = typeof body.assetAddress === "string" ? body.assetAddress.trim() : "";
    if (!assetAddress) return NextResponse.json({ error: "assetAddress is required" }, { status: 400 });
    const jobId = await enqueueApplicationJob(
      JOB_QUEUES.PARTNER_METAPLEX_INDEX,
      { v: 1, assetAddress },
      { singletonKey: assetAddress },
    );
    return NextResponse.json(
      { ok: true, accepted: true, queue: JOB_QUEUES.PARTNER_METAPLEX_INDEX, jobId, assetAddress },
      { status: 202 },
    );
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    console.error("[admin/metaplex/index] enqueue error:", message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
