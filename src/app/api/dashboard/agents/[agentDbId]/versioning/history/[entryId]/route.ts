import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sanitizeForPostgres } from "@/lib/utils";
import { requireDashboardAccessForApi } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
import {
  parseVersionManifest,
  VERSION_MANIFEST_KEY,
  VERSION_MANIFEST_MAX_JSON,
} from "@/lib/agent-version-manifest";
export const dynamic = "force-dynamic";
async function loadOwnedAgentId(
  session: Session | null,
  idParam: string,
): Promise<{ agentId: number } | { error: NextResponse }> {
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return { error: NextResponse.json({ error: "No profile" }, { status: 400 }) };
  }
  const walletFromProfile = profile.walletAddress?.trim();
  const walletFromSession = session?.user?.walletAddress?.trim();
  const w = walletFromProfile ?? walletFromSession ?? "";
  const agentId = Number.parseInt(idParam, 10);
  if (!Number.isFinite(agentId)) {
    return { error: NextResponse.json({ error: "Invalid id" }, { status: 400 }) };
  }
  const owned = await dashboardUserOwnsAgentDbId(w || null, agentId, profile.id);
  if (!owned) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { agentId };
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string; entryId: string }> },
) {
  const session = await getServerSession(authOptions);
  const dashboardAccess = await requireDashboardAccessForApi(session);
  if (!dashboardAccess.ok) {
    return NextResponse.json(
      { error: dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required" },
      { status: dashboardAccess.status },
    );
  }
  const { agentDbId, entryId } = await params;
  const resolved = await loadOwnedAgentId(session, agentDbId);
  if ("error" in resolved) return resolved.error;
  let body: { label?: unknown; releaseNotes?: unknown; trafficNote?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const row = await prisma.agentMetadata.findFirst({
    where: { agentId: resolved.agentId, key: VERSION_MANIFEST_KEY },
    select: { id: true, value: true },
  });
  const manifest = parseVersionManifest(row?.value ?? null);
  const idx = manifest.history.findIndex((h) => h.entryId === entryId);
  if (idx === -1) {
    return NextResponse.json({ error: "History entry not found" }, { status: 404 });
  }
  const label =
    body.label !== undefined
      ? sanitizeForPostgres(String(body.label).trim().slice(0, 64))
      : manifest.history[idx].label;
  if (!label) {
    return NextResponse.json({ error: "label required" }, { status: 400 });
  }
  const releaseNotes =
    body.releaseNotes !== undefined
      ? sanitizeForPostgres(String(body.releaseNotes).trim().slice(0, 2000))
      : manifest.history[idx].releaseNotes;
  const trafficNote =
    body.trafficNote !== undefined
      ? sanitizeForPostgres(String(body.trafficNote).trim().slice(0, 500))
      : manifest.history[idx].trafficNote;
  manifest.history[idx] = {
    ...manifest.history[idx],
    label,
    releaseNotes,
    trafficNote,
    updatedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(manifest);
  if (json.length > VERSION_MANIFEST_MAX_JSON) {
    return NextResponse.json({ error: "Manifest too large" }, { status: 400 });
  }
  if (!row) {
    return NextResponse.json({ error: "No version manifest yet — save current version first." }, { status: 404 });
  }
  await prisma.agentMetadata.update({ where: { id: row.id }, data: { value: json } });
  return NextResponse.json({ manifest });
}
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string; entryId: string }> },
) {
  const session = await getServerSession(authOptions);
  const dashboardAccess = await requireDashboardAccessForApi(session);
  if (!dashboardAccess.ok) {
    return NextResponse.json(
      { error: dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required" },
      { status: dashboardAccess.status },
    );
  }
  const { agentDbId, entryId } = await params;
  const resolved = await loadOwnedAgentId(session, agentDbId);
  if ("error" in resolved) return resolved.error;
  const row = await prisma.agentMetadata.findFirst({
    where: { agentId: resolved.agentId, key: VERSION_MANIFEST_KEY },
    select: { id: true, value: true },
  });
  const manifest = parseVersionManifest(row?.value ?? null);
  const nextHistory = manifest.history.filter((h) => h.entryId !== entryId);
  if (nextHistory.length === manifest.history.length) {
    return NextResponse.json({ error: "History entry not found" }, { status: 404 });
  }
  const next = { ...manifest, history: nextHistory };
  const json = JSON.stringify(next);
  if (json.length > VERSION_MANIFEST_MAX_JSON) {
    return NextResponse.json({ error: "Manifest too large" }, { status: 400 });
  }
  if (row) {
    await prisma.agentMetadata.update({ where: { id: row.id }, data: { value: json } });
  }
  return NextResponse.json({ manifest: next });
}
