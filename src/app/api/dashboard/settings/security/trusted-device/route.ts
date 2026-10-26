import { getServerSession } from "next-auth";
import { securityJsonResponse } from "@/lib/account-security/http-response";
import { authOptions } from "@/lib/auth";
import { clearMfaDeviceTrust, getMfaDeviceTrust } from "@/lib/account-security/mfa-trust";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
export const dynamic = "force-dynamic";
/** Forget this browser — clears the 7-day MFA trust cookie. */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.mfaVerified === false) {
    return securityJsonResponse({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return securityJsonResponse({ error: "Profile not found" }, { status: 404 });
  }
  await clearMfaDeviceTrust();
  return securityJsonResponse(
    {
      ok: true,
      trustedDevice: await getMfaDeviceTrust(profile.id, profile.mfaTrustVersion),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}