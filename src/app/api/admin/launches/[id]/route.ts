import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
export const dynamic = "force-dynamic";
const LAUNCH_PATCH_KEYS = new Set([
  "tokenName",
  "tokenSymbol",
  "tokenDescription",
  "tokenImageUrl",
  "launchStatus",
  "launchLifecycleStatus",
  "profileDisplayName",
  "profileShortDescription",
  "profileWebsite",
  "profileTwitter",
  "profileTelegram",
  "profileGithub",
  "arTokenVerificationStatus",
] as const);
/**
 * PATCH /api/admin/launches/[id]
 * Update launch metadata and status fields.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const keys = Object.keys(body);
  if (keys.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  if (!keys.every((k) => (LAUNCH_PATCH_KEYS as Set<string>).has(k))) {
    return NextResponse.json({ error: "One or more fields are not allowed" }, { status: 400 });
  }
  const existing = await prisma.agentLaunch.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    const raw = body[key];
    if (raw === undefined) continue;
    data[key] = typeof raw === "string" ? raw.trim() : String(raw);
  }
  if ("arTokenVerificationStatus" in data) {
    const status = String(data.arTokenVerificationStatus);
    if (status !== "verified" && status !== "unverified") {
      return NextResponse.json(
        { error: "arTokenVerificationStatus must be verified or unverified" },
        { status: 400 },
      );
    }
    if (status === "verified") {
      data.arTokenVerifiedAt = new Date();
      data.arTokenVerificationSource = "manual";
    } else {
      data.arTokenVerifiedAt = null;
      data.arTokenVerificationSource = null;
    }
  }
  try {
    const updated = await prisma.agentLaunch.update({
      where: { id },
      data,
    });
    return NextResponse.json({ launch: serializeAgentLaunch(updated) });
  } catch (err) {
    console.error("[admin/launches/[id]] PATCH error:", err);
    return NextResponse.json({ error: "Failed to update launch" }, { status: 500 });
  }
}