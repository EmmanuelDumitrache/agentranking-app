import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const MFA_TRUST_COOKIE = "ar_mfa_trust";
export const MFA_TRUST_MAX_AGE_SEC = 7 * 24 * 60 * 60;
const MFA_TRUST_TTL_MS = MFA_TRUST_MAX_AGE_SEC * 1000;

const TrustPayloadSchema = z.strictObject({
  v: z.literal(2),
  exp: z.number().int(),
  profileId: z.number().int().positive(),
  trustVersion: z.number().int().nonnegative(),
  jti: z.string().min(1),
});

type TrustPayload = z.infer<typeof TrustPayloadSchema>;

function signingSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("NEXTAUTH_SECRET must be set and at least 32 characters");
  }
  return secret;
}

function sign(encoded: string): string {
  return createHmac("sha256", signingSecret())
    .update(`mfa-trust:v2:${encoded}`)
    .digest("base64url");
}

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueMfaTrustToken(profileId: number, trustVersion: number): string {
  const payload: TrustPayload = {
    v: 2,
    exp: Date.now() + MFA_TRUST_TTL_MS,
    profileId,
    trustVersion,
    jti: randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function readMfaTrustToken(
  token: string,
  expectedProfileId: number,
  expectedTrustVersion: number,
):
  | { ok: true; expiresAt: number }
  | { ok: false; reason: "invalid" | "expired" | "mismatch" | "revoked" } {
  const trimmed = token.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const encoded = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  if (!equalText(sig, sign(encoded))) return { ok: false, reason: "invalid" };

  try {
    const raw: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const parsedResult = TrustPayloadSchema.safeParse(raw);
    if (!parsedResult.success) return { ok: false, reason: "invalid" };
    const parsed = parsedResult.data;
    if (parsed.exp < Date.now()) return { ok: false, reason: "expired" };
    if (parsed.profileId !== expectedProfileId) return { ok: false, reason: "mismatch" };
    if (parsed.trustVersion !== expectedTrustVersion) return { ok: false, reason: "revoked" };
    return { ok: true, expiresAt: parsed.exp };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function verifyMfaTrustToken(
  token: string,
  expectedProfileId: number,
  expectedTrustVersion: number,
): { ok: true } | { ok: false; reason: "invalid" | "expired" | "mismatch" | "revoked" } {
  const result = readMfaTrustToken(token, expectedProfileId, expectedTrustVersion);
  return result.ok ? { ok: true } : result;
}

export function mfaTrustCookieOptions(maxAgeSec = MFA_TRUST_MAX_AGE_SEC) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}
