import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth-session";
import { validateCuratedJobInput, type CuratedJobInput } from "@/lib/jobs/curated";
import { upsertPartnerJob } from "@/lib/jobs/sync";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as CuratedJobInput;
    const validated = validateCuratedJobInput(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const job = {
      ...validated.job,
      ingestionMode: "manual" as const,
      curatedBy: session.username ?? "admin",
      isSample: false,
    };
    const now = new Date();
    await upsertPartnerJob(job, now);
    return NextResponse.json({ ok: true, externalId: job.externalId });
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
