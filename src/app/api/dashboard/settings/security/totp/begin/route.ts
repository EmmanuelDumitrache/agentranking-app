import { getServerSession } from "next-auth";
import { securityJsonResponse } from "@/lib/account-security/http-response";
import { authOptions } from "@/lib/auth";
import { getMfaFactorFlags } from "@/lib/account-security/flags";
import { generateTotpSecret, totpQrDataUrl, totpUri } from "@/lib/account-security/totp";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
export const dynamic = "force-dynamic";
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.mfaVerified === false) {
    return securityJsonResponse({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return securityJsonResponse({ error: "Profile not found" }, { status: 404 });
  }
  const flags = getMfaFactorFlags(profile);
  if (flags.totpEnabled) {
    return securityJsonResponse({ error: "Authenticator is already enabled" }, { status: 400 });
  }
  const secret = generateTotpSecret();
  const label = profile.email || session.user.email || `user-${profile.id}`;
  const uri = totpUri(secret, label);
  const qrDataUrl = await totpQrDataUrl(secret, label);
  return securityJsonResponse(
    { secret, uri, qrDataUrl },
    { headers: { "Cache-Control": "no-store" } },
  );
}