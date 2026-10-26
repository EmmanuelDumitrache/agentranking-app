import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { isAdminIdentityAccessError } from "@/lib/admin/identity/auth.server";
import { readAdminCreatorDetail } from "@/lib/admin/identity/creators.server";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
/**
 * GET /api/admin/creators/[id]
 * PATCH — update UserProfile + AppAccount fields
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const creator = await readAdminCreatorDetail(id);
    if (!creator) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ creator });
  } catch (error) {
    if (isAdminIdentityAccessError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/creators/[id]] GET error:", error);
    return NextResponse.json({ error: "Failed to load creator" }, { status: 500 });
  }
}
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: {
    displayName?: string;
    email?: string;
    adminNotes?: string;
    maxAgents?: number;
    platformCredits?: number;
    llmCredits?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const existing = await prisma.appAccount.findUnique({
    where: { id },
    select: { id: true, userProfileId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const appAccountData: Record<string, unknown> = {};
  const profileData: Record<string, unknown> = {};
  if (body.displayName !== undefined) {
    const name = body.displayName.trim() || null;
    appAccountData.displayName = name;
    profileData.displayName = name;
  }
  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase() || null;
    appAccountData.email = email;
    profileData.email = email;
  }
  if (body.adminNotes !== undefined) profileData.adminNotes = body.adminNotes.trim();
  if (body.maxAgents !== undefined) {
    const n = Number(body.maxAgents);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json({ error: "maxAgents must be 0–100" }, { status: 400 });
    }
    appAccountData.maxAgents = Math.floor(n);
  }
  if (body.platformCredits !== undefined) {
    const n = Number(body.platformCredits);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "platformCredits must be ≥ 0" }, { status: 400 });
    }
    appAccountData.platformCredits = Math.floor(n);
  }
  if (body.llmCredits !== undefined) {
    const n = Number(body.llmCredits);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "llmCredits must be ≥ 0" }, { status: 400 });
    }
    appAccountData.llmCredits = Math.floor(n);
  }
  try {
    await prisma.$transaction(async (tx) => {
      if (Object.keys(appAccountData).length > 0) {
        await tx.appAccount.update({ where: { id }, data: appAccountData });
      }
      if (Object.keys(profileData).length > 0) {
        await tx.userProfile.update({
          where: { id: existing.userProfileId },
          data: profileData,
        });
      }
    });
    const creator = await readAdminCreatorDetail(id);
    return NextResponse.json({ creator });
  } catch (err) {
    console.error("[admin/creators/[id]] PATCH error:", err);
    return NextResponse.json({ error: "Failed to update creator" }, { status: 500 });
  }
}