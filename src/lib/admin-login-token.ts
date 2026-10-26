import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getAdminLoginBaseUrl } from "@/lib/site-url";
export const ADMIN_LOGIN_TOKEN_TTL_MS = 5 * 60 * 1000;

const AdminLoginPayloadSchema = z.strictObject({
  v: z.literal(1),
  exp: z.number().int(),
  code: z.string().min(1),
  remember: z.union([z.literal(0), z.literal(1)]),
});

type AdminLoginPayload = z.infer<typeof AdminLoginPayloadSchema>;
function normalizeEnvString(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  let s = value.trim().replace(/^\uFEFF/, "");
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.length ? s : undefined;
}
function signingSecret(): string {
  const secret = normalizeEnvString(process.env.ADMIN_SESSION_SECRET);
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be set and at least 32 characters");
  }
  return secret;
}
function signPayload(encodedPayload: string): string {
  return createHmac("sha256", signingSecret()).update(encodedPayload).digest("base64url");
}
function encodePayload(payload: AdminLoginPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
function decodePayload(encoded: string): AdminLoginPayload | null {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    const raw: unknown = JSON.parse(json);
    const parsed = AdminLoginPayloadSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export type IssuedAdminLoginToken = {
  loginToken: string;
  code: string;
  expiresAt: Date;
  completeUrl: string;
};
export function issueAdminLoginToken(rememberMe: boolean): IssuedAdminLoginToken {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const exp = Date.now() + ADMIN_LOGIN_TOKEN_TTL_MS;
  const payload: AdminLoginPayload = {
    v: 1,
    exp,
    code,
    remember: rememberMe ? 1 : 0,
  };
  const encoded = encodePayload(payload);
  const loginToken = `${encoded}.${signPayload(encoded)}`;
  const completeUrl = buildAdminLoginCompleteUrl(loginToken);
  return { loginToken, code, expiresAt: new Date(exp), completeUrl };
}
export type VerifyAdminLoginTokenResult =
  | { ok: true; rememberMe: boolean; code: string }
  | { ok: false; reason: "invalid" | "expired" | "code_mismatch" };
export function verifyAdminLoginToken(loginToken: string): VerifyAdminLoginTokenResult {
  const trimmed = loginToken.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const encoded = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  const expected = signPayload(encoded);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "invalid" };
  }
  const payload = decodePayload(encoded);
  if (!payload) return { ok: false, reason: "invalid" };
  if (payload.exp < Date.now()) return { ok: false, reason: "expired" };
  return {
    ok: true,
    rememberMe: payload.remember === 1,
    code: payload.code,
  };
}
export function verifyAdminLoginCode(
  loginToken: string,
  codeInput: string,
): VerifyAdminLoginTokenResult {
  const verified = verifyAdminLoginToken(loginToken);
  if (!verified.ok) return verified;
  const digits = codeInput.replace(/\D/g, "");
  if (digits.length !== 6 || digits !== verified.code) {
    return { ok: false, reason: "code_mismatch" };
  }
  return verified;
}
export function buildAdminLoginCompleteUrl(loginToken: string): string {
  const params = new URLSearchParams({ t: loginToken });
  return `${getAdminLoginBaseUrl()}/api/admin/auth/complete?${params.toString()}`;
}