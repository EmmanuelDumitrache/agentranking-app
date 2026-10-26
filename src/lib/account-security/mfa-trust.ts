import "server-only";
import { cookies } from "next/headers";
import {
  MFA_TRUST_COOKIE,
  readMfaTrustToken,
} from "@/lib/account-security/mfa-trust-token";

export {
  issueMfaTrustToken,
  verifyMfaTrustToken,
  readMfaTrustToken,
  mfaTrustCookieOptions,
  MFA_TRUST_COOKIE,
  MFA_TRUST_MAX_AGE_SEC,
} from "@/lib/account-security/mfa-trust-token";

export type MfaDeviceTrustStatus = {
  active: boolean;
  expiresAt: string | null;
};

/** True when this browser has a valid, non-revoked MFA trust cookie for the profile. */
export async function isMfaDeviceTrusted(
  profileId: number,
  trustVersion: number,
): Promise<boolean> {
  return (await getMfaDeviceTrust(profileId, trustVersion)).active;
}

/** Current MFA “remember this browser” cookie state for settings UI. */
export async function getMfaDeviceTrust(
  profileId: number,
  trustVersion: number,
): Promise<MfaDeviceTrustStatus> {
  const jar = await cookies();
  const raw = jar.get(MFA_TRUST_COOKIE)?.value;
  if (!raw) return { active: false, expiresAt: null };
  const verified = readMfaTrustToken(raw, profileId, trustVersion);
  if (!verified.ok) return { active: false, expiresAt: null };
  return { active: true, expiresAt: new Date(verified.expiresAt).toISOString() };
}

/** Clears the httpOnly MFA trust cookie on this browser. */
export async function clearMfaDeviceTrust(): Promise<void> {
  const jar = await cookies();
  jar.set(MFA_TRUST_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
