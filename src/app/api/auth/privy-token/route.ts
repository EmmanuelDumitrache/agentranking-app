/**
 * GET /api/auth/privy-token
 *
 * Returns a short-lived RS256 JWT that identifies the current NextAuth user
 * to Privy's custom-auth system.  Requires a valid AgentRanking session.
 *
 * The JWT `sub` claim is the stable UserProfile.id (integer as string).
 */
import { NextResponse } from "next/server";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { signPrivyJwt, getJwtConfig } from "@/lib/jwt-utils.server";
export const dynamic = "force-dynamic";
export async function GET() {
  const session = await getCachedDashboardSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  try {
    const profile = await getDashboardUserProfile(session);
    if (!profile) {
      return NextResponse.json({ error: "User profile not found" }, { status: 401 });
    }
    const cfg = getJwtConfig();
    if (!cfg.configured) {
      return NextResponse.json(
        { error: "Privy JWT signing is not configured (PRIVY_JWT_PRIVATE_KEY_B64 missing)." },
        { status: 500 },
      );
    }
    const token = await signPrivyJwt({
      sub: String(profile.id), // stable internal UserProfile ID
      email: profile.email ?? undefined,
      iss: cfg.issuer,
      aud: cfg.audience,
    });
    return NextResponse.json({ token }, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[privy-token]", err);
    return NextResponse.json(
      { error: "Failed to generate Privy JWT" },
      { status: 500 },
    );
  }
}
