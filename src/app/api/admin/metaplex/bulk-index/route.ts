import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { enqueueApplicationJobs } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
export const dynamic = "force-dynamic";
/** POST /api/admin/metaplex/bulk-index — fan out Core assets into durable per-asset jobs. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await request.json()) as { assetAddresses?: unknown };
    const assetAddresses = Array.from(new Set(
      (Array.isArray(body.assetAddresses) ? body.assetAddresses : [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    )).slice(0, 500);
    if (assetAddresses.length === 0) {
      return NextResponse.json({ error: "assetAddresses is required" }, { status: 400 });
    }
    const requests = assetAddresses.map((assetAddress) => ({ assetAddress, id: randomUUID() }));
    const queuedIds = new Set(await enqueueApplicationJobs(
      JOB_QUEUES.PARTNER_METAPLEX_INDEX,
      requests.map(({ assetAddress, id }) => ({
        id,
        data: { v: 1, assetAddress },
        singletonKey: assetAddress,
      })),
    ));
    const results = requests.map(({ assetAddress, id }) => ({
      assetAddress,
      jobId: queuedIds.has(id) ? id : null,
    }));
    return NextResponse.json(
      {
        ok: true,
        accepted: true,
        queue: JOB_QUEUES.PARTNER_METAPLEX_INDEX,
        total: results.length,
        queued: results.filter((row) => row.jobId !== null).length,
        deduplicated: results.filter((row) => row.jobId === null).length,
        results,
      },
      { status: 202 },
    );
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    console.error("[admin/metaplex/bulk-index] enqueue error:", message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
