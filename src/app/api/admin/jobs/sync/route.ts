import { NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth-session";
import { enqueueApplicationJob } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
export const dynamic = "force-dynamic";
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const jobId = await enqueueApplicationJob(
      JOB_QUEUES.PARTNER_JOBS_SCAN,
      { v: 1 },
      { singletonKey: "admin" },
    );
    return NextResponse.json(
      { ok: true, accepted: true, queue: JOB_QUEUES.PARTNER_JOBS_SCAN, jobId },
      { status: 202 },
    );
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
