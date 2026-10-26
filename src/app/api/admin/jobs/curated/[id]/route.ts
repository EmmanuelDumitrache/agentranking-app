import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth-session";
import { validateCuratedJobInput, type CuratedJobInput } from "@/lib/jobs/curated";
import { upsertPartnerJob } from "@/lib/jobs/sync";
import type { JobIngestionMode } from "@/lib/jobs/types";
export const dynamic = "force-dynamic";
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    const existing = await prisma.partnerJob.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = (await request.json()) as CuratedJobInput & { status?: string };
    const validated = validateCuratedJobInput({
      ...body,
      source: body.source ?? existing.source,
      externalId: body.externalId ?? existing.externalId,
      applyUrl: body.applyUrl ?? existing.applyUrl,
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
    });
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const ingestionMode: JobIngestionMode =
      existing.ingestionMode === "seed" ? "manual" : (existing.ingestionMode as JobIngestionMode);
    const job = {
      ...validated.job,
      externalId: existing.externalId,
      ingestionMode,
      curatedBy: session.username ?? existing.curatedBy ?? "admin",
      isSample: false,
    };
    await upsertPartnerJob(job, new Date());
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { id } = await params;
    await prisma.partnerJob.update({
      where: { id },
      data: { status: "closed" },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = Error.isError(e) ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
