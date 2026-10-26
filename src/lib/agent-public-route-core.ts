import { toAgentUrlSlug } from "@/lib/agent-public-url";

export type AgentRouteSlugMismatchReason =
  | "case_mismatch"
  | "name_changed"
  | "normalization_mismatch";

export type AgentRouteSlugValidation =
  | {
      ok: true;
      requestedSlug: string;
      canonicalSlug: string;
    }
  | {
      ok: false;
      reason: "malformed_slug" | AgentRouteSlugMismatchReason;
      canonicalSlug: string | null;
    };

/**
 * Accept either a decoded Next.js route parameter or one encoded URL segment.
 * Decoding happens at most once, and a decoded path separator can never escape
 * the final route segment.
 */
export function decodePublicAgentSlug(raw: string): string | null {
  if (raw.length === 0 || raw.length > 512) return null;

  try {
    const decoded = raw.includes("%") ? decodeURIComponent(raw) : raw;
    if (!decoded || decoded.includes("/") || decoded.includes("\\")) return null;
    if (/\p{Cc}|\p{Cf}/u.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/** Exact current-name slug validation. It never returns a redirect target. */
export function validatePublicAgentSlug(input: {
  requestedSlug: string;
  currentName: string;
}): AgentRouteSlugValidation {
  const canonicalSlug = toAgentUrlSlug(input.currentName);
  const requestedSlug = decodePublicAgentSlug(input.requestedSlug);
  if (requestedSlug == null) {
    return { ok: false, reason: "malformed_slug", canonicalSlug: null };
  }
  if (requestedSlug === canonicalSlug) {
    return { ok: true, requestedSlug, canonicalSlug };
  }
  if (requestedSlug.toLowerCase() === canonicalSlug) {
    return { ok: false, reason: "case_mismatch", canonicalSlug };
  }
  if (toAgentUrlSlug(requestedSlug) === canonicalSlug) {
    return { ok: false, reason: "normalization_mismatch", canonicalSlug };
  }
  return { ok: false, reason: "name_changed", canonicalSlug };
}
