import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  valkeyDeleteIfValueMatches,
  valkeyGetString,
  valkeySetStringNxPx,
} from "@/lib/valkey";

const MFA_COMPLETION_TTL_MS = 5 * 60 * 1000;
const MFA_COMPLETION_KEY_PREFIX = "auth:mfa-completion:v2:";

const MfaCompletionPayloadSchema = z.strictObject({
  v: z.literal(2),
  exp: z.number().int(),
  profileId: z.number().int().positive(),
  authUserId: z.string().min(1),
  email: z.string().min(1).nullable(),
  jti: z.string().min(1),
});

type Payload = z.infer<typeof MfaCompletionPayloadSchema>;

function signingSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("NEXTAUTH_SECRET must be set and at least 32 characters");
  }
  return secret;
}

function sign(encoded: string): string {
  return createHmac("sha256", signingSecret())
    .update(`mfa-complete:v2:${encoded}`)
    .digest("base64url");
}

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function tokenKey(jti: string): string {
  return `${MFA_COMPLETION_KEY_PREFIX}${jti}`;
}

export async function issueMfaCompletionToken(input: {
  profileId: number;
  authUserId: string;
  email: string | null;
}): Promise<string> {
  const exp = Date.now() + MFA_COMPLETION_TTL_MS;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload: Payload = {
      v: 2,
      exp,
      profileId: input.profileId,
      authUserId: input.authUserId,
      email: input.email,
      jti: randomUUID(),
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const token = `${encoded}.${sign(encoded)}`;
    if (await valkeySetStringNxPx(tokenKey(payload.jti), token, MFA_COMPLETION_TTL_MS)) {
      return token;
    }
  }
  throw new Error("Could not allocate a unique MFA completion token");
}

export type MfaCompletionResult =
  | { ok: true; profileId: number; authUserId: string; email: string | null }
  | { ok: false; reason: "invalid" | "expired" | "consumed" };

export async function verifyMfaCompletionToken(token: string): Promise<MfaCompletionResult> {
  const trimmed = token.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const encoded = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  if (!equalText(sig, sign(encoded))) return { ok: false, reason: "invalid" };

  let parsed: Payload;
  try {
    const raw: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const result = MfaCompletionPayloadSchema.safeParse(raw);
    if (!result.success) return { ok: false, reason: "invalid" };
    parsed = result.data;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.exp < Date.now()) return { ok: false, reason: "expired" };

  const stored = await valkeyGetString(tokenKey(parsed.jti));
  if (stored === null || !equalText(stored, trimmed)) return { ok: false, reason: "consumed" };
  if (!(await valkeyDeleteIfValueMatches(tokenKey(parsed.jti), stored))) {
    return { ok: false, reason: "consumed" };
  }
  return {
    ok: true,
    profileId: parsed.profileId,
    authUserId: parsed.authUserId,
    email: parsed.email,
  };
}
