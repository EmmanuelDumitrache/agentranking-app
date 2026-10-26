import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import { upsertDashboardAuthUser } from "@/lib/dashboard/auth-users";
import { readDashboardClaimToken } from "@/lib/dashboard/claim-page.server";
export const dynamic = "force-dynamic";
/**
 * POST /api/dashboard/claim
 * Validates a claim token and sets the user's password.
 * Returns the user's email so the caller can sign in via credentials.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { token: string; password: string };
    const { token, password } = body;
    if (!token || !password) {
      return NextResponse.json({ error: "Token and password are required." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    const profile = await prisma.userProfile.findUnique({ where: { claimToken: token } });
    if (!profile) {
      return NextResponse.json({ error: "Invalid or expired claim link." }, { status: 404 });
    }
    if (profile.claimTokenExpiresAt && profile.claimTokenExpiresAt < new Date()) {
      return NextResponse.json({ error: "This claim link has expired. Contact support for a new one." }, { status: 410 });
    }
    if (profile.isClaimed) {
      // Allow re-claim for password reset via this endpoint (token already used)
      // Just return email so they can sign in
      return NextResponse.json({ email: profile.email, alreadyClaimed: true });
    }
    const passwordHash = await hash(password, 12);
    await prisma.userProfile.update({
      where: { id: profile.id },
      data: {
        passwordHash,
        isClaimed: true,
        claimedAt: new Date(),
        // Keep claimToken so admin can see it was used
      },
    });
    if (profile.email) {
      await upsertDashboardAuthUser(profile.email, profile.displayName);
    }
    return NextResponse.json({ email: profile.email, alreadyClaimed: false });
  } catch (err) {
    console.error("[api/dashboard/claim] POST error:", err);
    return NextResponse.json({ error: "Failed to claim account." }, { status: 500 });
  }
}
/** GET /api/dashboard/claim?token=... — transport adapter for claim metadata. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const result = await readDashboardClaimToken(token);
  return NextResponse.json(result, { status: token.trim() ? 200 : 400 });
}
