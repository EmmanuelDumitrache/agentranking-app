import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDashboardAuthBaseUrl } from "@/lib/dashboard/auth-base-url";
import {
  slidingWindowLimitMany,
  valkeyEval,
  valkeyGetString,
  valkeySetStringNxPx,
} from "@/lib/valkey";

/** Email OTP sign-in codes stay valid for 20 minutes. */
export const DASHBOARD_LOGIN_TOKEN_TTL_MS = 20 * 60 * 1000;
const LOGIN_TOKEN_KEY_PREFIX = "auth:dashboard-email-token:[REDACTED:API key param]";
const LOGIN_ATTEMPT_KEY_PREFIX = "auth:dashboard-email-attempts:v2:";
const LOGIN_TOKEN_ATTEMPT_LIMIT = 12;

export type DashboardLoginPurpose = "sign_in" | "mfa" | "enroll";

const DashboardLoginPayloadSchema = z.strictObject({
  v: z.literal(2),
  exp: z.number().int(),
  email: z.string().min(1),
  purpose: z.enum(["sign_in", "mfa", "enroll"]),
  jti: z.string().min(1),
  codeDigest: z.string().min(1),
});

type DashboardLoginPayload = z.infer<typeof DashboardLoginPayloadSchema>;

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
  const secret = normalizeEnvString(process.env.NEXTAUTH_SECRET);
  if (!secret || secret.length < 32) {
    throw new Error("NEXTAUTH_SECRET must be set and at least 32 characters");
  }
  return secret;
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", signingSecret())
    .update(`dashboard-email-token:v2:${encodedPayload}`)
    .digest("base64url");
}

function digestCode(input: {
  jti: string;
  email: string;
  purpose: DashboardLoginPurpose;
  code: string;
}): string {
  return createHmac("sha256", signingSecret())
    .update(`dashboard-email-code:v2:${input.jti}:${input.email}:${input.purpose}:${input.code}`)
    .digest("base64url");
}

function encodePayload(payload: DashboardLoginPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encoded: string): DashboardLoginPayload | null {
  try {
    const raw: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const parsed = DashboardLoginPayloadSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function tokenKey(jti: string): string {
  return `${LOGIN_TOKEN_KEY_PREFIX}${jti}`;
}

function attemptKey(jti: string): string {
  return `${LOGIN_ATTEMPT_KEY_PREFIX}${jti}`;
}

const CONSUME_OR_REVOKE_TOKEN_LUA = `
redis.setresp(3)
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  return 1
end
return 0
`;

async function consumeOrRevokeToken(payload: DashboardLoginPayload, expected: string): Promise<boolean> {
  const result = await valkeyEval({
    script: CONSUME_OR_REVOKE_TOKEN_LUA,
    keys: [tokenKey(payload.jti), attemptKey(payload.jti)],
    args: [expected],
  });
  return Number(result) === 1;
}

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readSignedPayload(token: string): DashboardLoginPayload | null {
  const trimmed = token.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = trimmed.slice(0, dot);
  const signature = trimmed.slice(dot + 1);
  if (!equalText(signature, signPayload(encoded))) return null;
  return decodePayload(encoded);
}

export type IssuedDashboardLoginToken = {
  loginToken: string;
  code: string;
  expiresAt: Date;
  completeUrl: string;
  email: string;
  purpose: DashboardLoginPurpose;
};

export async function issueDashboardLoginToken(
  email: string,
  options: { purpose?: DashboardLoginPurpose } = {},
): Promise<IssuedDashboardLoginToken> {
  const normalized = email.trim().toLowerCase();
  const purpose = options.purpose ?? "sign_in";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const exp = Date.now() + DASHBOARD_LOGIN_TOKEN_TTL_MS;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const jti = randomUUID();
    const payload: DashboardLoginPayload = {
      v: 2,
      exp,
      email: normalized,
      purpose,
      jti,
      codeDigest: digestCode({ jti, email: normalized, purpose, code }),
    };
    const encoded = encodePayload(payload);
    const loginToken = `${encoded}.${signPayload(encoded)}`;
    if (await valkeySetStringNxPx(tokenKey(jti), loginToken, DASHBOARD_LOGIN_TOKEN_TTL_MS)) {
      return {
        loginToken,
        code,
        expiresAt: new Date(exp),
        completeUrl: buildDashboardLoginUrl(loginToken, code, purpose),
        email: normalized,
        purpose,
      };
    }
  }

  throw new Error("Could not allocate a unique dashboard email token");
}

export type VerifyDashboardLoginTokenResult =
  | { ok: true; email: string; purpose: DashboardLoginPurpose }
  | {
      ok: false;
      reason:
        | "invalid"
        | "expired"
        | "code_mismatch"
        | "consumed"
        | "purpose_mismatch"
        | "rate_limited";
    };

export async function verifyDashboardLoginCode(
  loginToken: string,
  codeInput: string,
  options: { purpose?: DashboardLoginPurpose; consume?: boolean } = {},
): Promise<VerifyDashboardLoginTokenResult> {
  const trimmed = loginToken.trim();
  const payload = readSignedPayload(trimmed);
  if (!payload) return { ok: false, reason: "invalid" };
  if (payload.exp < Date.now()) return { ok: false, reason: "expired" };
  const expectedPurpose = options.purpose ?? "sign_in";
  if (payload.purpose !== expectedPurpose) return { ok: false, reason: "purpose_mismatch" };

  const stored = await valkeyGetString(tokenKey(payload.jti));
  if (stored === null || !equalText(stored, trimmed)) {
    return { ok: false, reason: "consumed" };
  }

  const attemptBudget = await slidingWindowLimitMany([
    {
      key: attemptKey(payload.jti),
      limit: LOGIN_TOKEN_ATTEMPT_LIMIT,
      windowMs: DASHBOARD_LOGIN_TOKEN_TTL_MS,
    },
  ]);
  if (!attemptBudget.success) return { ok: false, reason: "rate_limited" };

  const digits = codeInput.replace(/\D/g, "");
  if (digits.length !== 6) return { ok: false, reason: "code_mismatch" };
  const expectedDigest = digestCode({
    jti: payload.jti,
    email: payload.email,
    purpose: payload.purpose,
    code: digits,
  });
  if (!equalText(payload.codeDigest, expectedDigest)) {
    return { ok: false, reason: "code_mismatch" };
  }

  if (options.consume !== false) {
    const consumed = await consumeOrRevokeToken(payload, stored);
    if (!consumed) return { ok: false, reason: "consumed" };
  }

  return { ok: true, email: payload.email.trim().toLowerCase(), purpose: payload.purpose };
}

/** Revoke an issued email token after an authenticated delivery failure. */
export async function revokeDashboardLoginToken(loginToken: string): Promise<boolean> {
  const trimmed = loginToken.trim();
  const payload = readSignedPayload(trimmed);
  if (!payload) return false;
  const stored = await valkeyGetString(tokenKey(payload.jti));
  if (stored === null || !equalText(stored, trimmed)) return false;
  return consumeOrRevokeToken(payload, stored);
}

export function buildDashboardLoginUrl(
  loginToken: string,
  _code?: string,
  purpose: DashboardLoginPurpose = "sign_in",
): string {
  if (purpose !== "sign_in") {
    // MFA and enrollment emails carry the code in the message; opening the app
    // should never route their purpose-bound token through the primary sign-in provider.
    return `${getDashboardAuthBaseUrl()}/dashboard/settings`;
  }
  const params = new URLSearchParams({ loginToken });
  return `${getDashboardAuthBaseUrl()}/dashboard/auth/sign-in?${params.toString()}`;
}
