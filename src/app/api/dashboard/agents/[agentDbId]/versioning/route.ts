import { NextRequest, NextResponse } from "next/server";
import { randomUUIDv7 } from "@/lib/uuid-v7";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sanitizeForPostgres } from "@/lib/utils";
import { requireDashboardAccessForApi } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile, getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
import { loadDashboardVersionManifest } from "@/lib/dashboard/agent-detail";
import {
  parseVersionManifest,
  VERSION_MANIFEST_KEY,
  VERSION_MANIFEST_MAX_JSON,
  type VersionManifest,
} from "@/lib/agent-version-manifest";
export const dynamic = "force-dynamic";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const dashboardAccess = await requireDashboardAccessForApi(session);
  if (!dashboardAccess.ok) {
    return NextResponse.json(
      { error: dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required" },
      { status: dashboardAccess.status },
    );
  }
  const profile = await getDashboardUserProfile(session);
  const walletFromProfile = profile?.walletAddress?.trim();
  const walletFromSession = session?.user?.walletAddress?.trim();
  const w = walletFromProfile ?? walletFromSession ?? "";
  const { agentDbId } = await params;
  const agentId = Number.parseInt(agentDbId, 10);
  if (!Number.isFinite(agentId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const owned = await dashboardUserOwnsAgentDbId(w || null, agentId, profile?.id);
  if (!owned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const manifest = await loadDashboardVersionManifest(agentId);
  return NextResponse.json({ manifest });
}
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const dashboardAccess = await requireDashboardAccessForApi(session);
  if (!dashboardAccess.ok) {
    return NextResponse.json(
      { error: dashboardAccess.status === 401 ? "Unauthorized" : "subscription_required" },
      { status: dashboardAccess.status },
    );
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "No profile" }, { status: 400 });
  }
  const walletFromProfile = profile.walletAddress?.trim();
  const walletFromSession = session?.user?.walletAddress?.trim();
  const w = walletFromProfile ?? walletFromSession ?? "";
  const { agentDbId } = await params;
  const agentId = Number.parseInt(agentDbId, 10);
  if (!Number.isFinite(agentId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const owned = await dashboardUserOwnsAgentDbId(w || null, agentId, profile.id);
  if (!owned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: { label?: unknown; releaseNotes?: unknown; trafficNote?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const label = sanitizeForPostgres(String(body.label ?? "").trim().slice(0, 64));
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  const releaseNotes = sanitizeForPostgres(String(body.releaseNotes ?? "").trim().slice(0, 2000));
  const trafficNote = sanitizeForPostgres(String(body.trafficNote ?? "").trim().slice(0, 500));
  const row = await prisma.agentMetadata.findFirst({
    where: { agentId, key: VERSION_MANIFEST_KEY },
    select: { id: true, value: true },
  });
  const prev = parseVersionManifest(row?.value ?? null);
  const now = new Date().toISOString();
  const history = [...prev.history];
  if (prev.current.label !== label) {
    history.unshift({
      entryId: prev.current.entryId || randomUUIDv7(),
      label: prev.current.label,
      releaseNotes: prev.current.releaseNotes,
      trafficNote: prev.current.trafficNote,
      updatedAt: prev.current.updatedAt || now,
    });
    if (history.length > 40) history.length = 40;
  }
  const next: VersionManifest = {
    current: {
      entryId: randomUUIDv7(),
      label,
      releaseNotes,
      trafficNote,
      updatedAt: now,
    },
    history,
  };
  const json = JSON.stringify(next);
  if (json.length > VERSION_MANIFEST_MAX_JSON) {
    return NextResponse.json({ error: "Manifest too large" }, { status: 400 });
  }
  if (row) {
    await prisma.agentMetadata.update({
      where: { id: row.id },
      data: { value: json },
    });
  } else {
    await prisma.agentMetadata.create({
      data: { agentId, key: VERSION_MANIFEST_KEY, value: json },
    });
  }
  return NextResponse.json({ manifest: next });
}
