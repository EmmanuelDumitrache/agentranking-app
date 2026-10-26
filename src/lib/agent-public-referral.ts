import { sanitizeForPostgres } from "@/lib/utils";
import { absoluteUrl } from "@/lib/site-url";
import { agentPublicPath } from "@/lib/agent-public-url";
/** Empty code is allowed; non-empty codes are capped for URL safety. */
export const PUBLIC_REFERRAL_CODE_MAX = 64;
export const PUBLIC_REFERRAL_DEST_MAX = 500;
export const PUBLIC_REFERRAL_INFO_MAX = 500;
/**
 * Form field limit for “short link” inputs — allows pasting a full `https://…` URL; the server extracts
 * the last path segment as the stored slug (still max {@link PUBLIC_REFERRAL_CODE_MAX}).
 */
export const PUBLIC_REFERRAL_CODE_FIELD_MAX = PUBLIC_REFERRAL_DEST_MAX;
export type PublicReferralValidationResult =
  | { ok: true; code: string | null; destination: string; info: string }
  | { ok: false; error: string };
/**
 * Returns normalized lowercase code, or null if empty (clear referral).
 */
export function normalizePublicReferralCodeInput(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  return s;
}
export function validatePublicReferralCode(code: string | null): { ok: true; code: string | null } | { ok: false; error: string } {
  if (code == null || code === "") return { ok: true, code: null };
  if (code.length > PUBLIC_REFERRAL_CODE_MAX) {
    return { ok: false, error: `Referral code must be at most ${PUBLIC_REFERRAL_CODE_MAX} characters.` };
  }
  if (/[/?#\s]/.test(code)) {
    return { ok: false, error: "Referral code cannot contain spaces, /, ?, or #." };
  }
  return { ok: true, code: sanitizeForPostgres(code) };
}
export type ExpandPublicReferralCodeResult = {
  readonly code: unknown;
  /**
   * When the user pasted a full `http(s)` URL into the code field and destination was empty,
   * the full URL is applied as destination. Otherwise `null` (caller keeps their destination string).
   */
  readonly destinationIfInjected: string | null;
};
/**
 * If `codeInput` looks like a full http(s) URL, returns the last path segment (lowercased) as `code`
 * and, when `destinationBefore` is empty, sets `destinationIfInjected` to the trimmed URL so redirects
 * keep the exact referral link (including casing).
 */
export function expandPublicReferralCodeIfPastedUrl(
  codeInput: unknown,
  destinationBefore: string,
): ExpandPublicReferralCodeResult {
  if (codeInput === null || codeInput === undefined) {
    return { code: codeInput, destinationIfInjected: null };
  }
  const trimmed = String(codeInput).trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    return { code: codeInput, destinationIfInjected: null };
  }
  try {
    const u = new URL(trimmed);
    const segments = u.pathname.split("/").filter(Boolean);
    const last = segments.at(-1);
    if (!last) return { code: codeInput, destinationIfInjected: null };
    const codeOut = last.toLowerCase();
    const destTrim = destinationBefore.trim();
    if (destTrim) {
      return { code: codeOut, destinationIfInjected: null };
    }
    return { code: codeOut, destinationIfInjected: trimmed };
  } catch {
    return { code: codeInput, destinationIfInjected: null };
  }
}
function destinationLooksBlocked(trimmed: string): boolean {
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:")
  );
}
/** Accepts any trimmed string within length; blocks only known-dangerous URL schemes. */
export function validatePublicReferralDestination(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!trimmed) return { ok: true, value: "" };
  if (trimmed.length > PUBLIC_REFERRAL_DEST_MAX) {
    return { ok: false, error: `Destination must be at most ${PUBLIC_REFERRAL_DEST_MAX} characters.` };
  }
  if (destinationLooksBlocked(trimmed)) {
    return { ok: false, error: "Destination URL scheme is not allowed." };
  }
  return { ok: true, value: sanitizeForPostgres(trimmed.slice(0, PUBLIC_REFERRAL_DEST_MAX)) };
}
export function validatePublicReferralInfo(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  if (s.length > PUBLIC_REFERRAL_INFO_MAX) {
    return { ok: false, error: `Info text must be at most ${PUBLIC_REFERRAL_INFO_MAX} characters.` };
  }
  return { ok: true, value: sanitizeForPostgres(s) };
}
export function parsePublicReferralBody(body: Record<string, unknown>): PublicReferralValidationResult {
  const destStr =
    body.publicReferralDestination === undefined || body.publicReferralDestination === null
      ? ""
      : String(body.publicReferralDestination).trim();
  const exp = expandPublicReferralCodeIfPastedUrl(body.publicReferralCode, destStr);
  const mergedDest = exp.destinationIfInjected ?? destStr;
  const codeRaw = normalizePublicReferralCodeInput(exp.code);
  const codeCheck = validatePublicReferralCode(codeRaw);
  if (!codeCheck.ok) return codeCheck;
  const destCheck = validatePublicReferralDestination(mergedDest);
  if (!destCheck.ok) return destCheck;
  const infoCheck = validatePublicReferralInfo(body.publicReferralInfo);
  if (!infoCheck.ok) return infoCheck;
  return {
    ok: true,
    code: codeCheck.code,
    destination: destCheck.value,
    info: infoCheck.value,
  };
}
export function defaultAgentProfilePath(chainId: number, agentId: number, name: string): string {
  return agentPublicPath({ chainId, agentId, name });
}

export function buildPublicReferralRedirectUrl(params: {
  requestOrigin: string;
  destination: string;
  chainId: number;
  agentId: number;
  name: string;
  code: string;
}): URL {
  const { destination, chainId, agentId, name, code, requestOrigin } = params;
  const base = defaultAgentProfilePath(chainId, agentId, name);
  const site = getSiteUrlFromRequest(requestOrigin);
  const siteOrigin = site.replace(/\/$/, "");
  const d = (destination ?? "").trim();
  if (!d) {
    const target = new URL(base, siteOrigin);
    target.searchParams.set("aref", code);
    return target;
  }
  if (destinationLooksBlocked(d)) {
    const target = new URL(base, siteOrigin);
    target.searchParams.set("aref", code);
    return target;
  }
  let target: URL;
  try {
    if (d.startsWith("//")) {
      target = new URL(d, siteOrigin);
    } else if (/^https?:\/\//i.test(d)) {
      target = new URL(d);
    } else if (d.startsWith("/")) {
      target = new URL(d, siteOrigin);
    } else {
      target = new URL(d, `${siteOrigin}/`);
    }
  } catch {
    const fallback = new URL(base, siteOrigin);
    fallback.searchParams.set("aref", code);
    return fallback;
  }
  const siteUrl = new URL(siteOrigin);
  if (target.origin === siteUrl.origin) {
    if (!target.searchParams.has("aref")) {
      target.searchParams.set("aref", code);
    }
  }
  return target;
}
function getSiteUrlFromRequest(requestOrigin: string): string {
  const t = requestOrigin?.trim();
  if (t && (t.startsWith("http://") || t.startsWith("https://"))) {
    return t.replace(/\/$/, "");
  }
  return absoluteUrl("");
}
/** Profile / API: show the referral box when there is a short code and/or an outbound destination. */
export function agentHasPublicReferralLink(params: {
  publicReferralCode?: string | null;
  publicReferralDestination?: string | null;
}): boolean {
  return Boolean(params.publicReferralCode?.trim()) || Boolean(params.publicReferralDestination?.trim());
}
export function publicReferralSharePath(code: string): string {
  return `/ag-ref/${encodeURIComponent(code)}`;
}
export function publicReferralShareAbsoluteUrl(code: string): string {
  return absoluteUrl(publicReferralSharePath(code));
}
