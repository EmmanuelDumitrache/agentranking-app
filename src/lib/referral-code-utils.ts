/** Shared validation for referral short codes (URLs, cookies, lookups). */
const MIN_LEN = 3;
const MAX_LEN = 40;
/** Lowercase alphanumerics and single hyphens (no leading/trailing/consecutive hyphens). */
const CODE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED = new Set([
  "admin",
  "api",
  "r",
  "ref",
  "verify",
  "verified",
  "credentials",
  "token",
  "agents",
  "dashboard",
  "advertise",
  "launch",
  "register",
  "login",
  "logout",
  "help",
  "support",
  "about",
  "terms",
  "privacy",
  "null",
  "undefined",
  "test",
  "www",
  "mail",
  "ftp",
  "static",
  "assets",
  "_next",
]);
export function normalizeReferralCode(raw: string): string {
  return raw.trim().toLowerCase().replaceAll(/\s+/g, "");
}
/**
 * From a pasted referral link (e.g. `https://agentranking.io/r/my-code`) or a bare code.
 * Returns the `/r/…` segment when present; otherwise {@link normalizeReferralCode}.
 */
export function extractReferralCodeFromInput(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const pathMatch = t.match(/\/r\/([^/?#\s]+)/i);
  if (pathMatch?.[1]) {
    return pathMatch[1].trim().toLowerCase();
  }
  return normalizeReferralCode(t);
}
export type ReferralCodeValidation =
  | { ok: true; code: string }
  | { ok: false; error: string };
export function validateReferralCode(normalized: string): ReferralCodeValidation {
  if (!normalized) {
    return { ok: false, error: "Enter a code." };
  }
  if (normalized.length < MIN_LEN || normalized.length > MAX_LEN) {
    return { ok: false, error: `Use ${MIN_LEN}–${MAX_LEN} characters.` };
  }
  if (!CODE_RE.test(normalized)) {
    return {
      ok: false,
      error: "Use letters, numbers, and single hyphens only (e.g. my-agent or verify123).",
    };
  }
  if (RESERVED.has(normalized)) {
    return { ok: false, error: "That code is reserved. Try another." };
  }
  return { ok: true, code: normalized };
}
