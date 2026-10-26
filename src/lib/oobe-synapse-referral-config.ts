/**
 * OOBE Synapse referral strip (SAP dashboard) — single place to configure.
 *
 * - Set `NEXT_PUBLIC_OOBE_SYNAPSE_REFERRAL_URL` to override the outbound Synapse URL
 *   (must be a valid `https?://` URL). Casing in the path is preserved for “Copy code”.
 * - Optional: `NEXT_PUBLIC_OOBE_SYNAPSE_REFERRAL_QR_PATH` — public path to QR PNG
 *   (default `/images/oobe-synapse-referral-qr.png`).
 * - Flip `OOBE_SYNAPSE_REFERRAL_STRIP_ENABLED` to `false` to hide the strip without
 *   removing code.
 */
export const OOBE_SYNAPSE_REFERRAL_STRIP_ENABLED = true;
export const DEFAULT_OOBE_SYNAPSE_REFERRAL_URL = "https://synapse.oobeprotocol.ai/r/ref_jy3z67SP1rtD";
export const DEFAULT_OOBE_SYNAPSE_REFERRAL_QR_PATH = "/images/oobe-synapse-referral-qr.png";
function readEnvUrl(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const raw = process.env.NEXT_PUBLIC_OOBE_SYNAPSE_REFERRAL_URL?.trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    /* ignore */
  }
  return undefined;
}
/** Resolved Synapse referral URL (env wins when valid). */
export function getOobeSynapseReferralUrl(): string {
  return readEnvUrl() ?? DEFAULT_OOBE_SYNAPSE_REFERRAL_URL;
}
/**
 * Segment used for “Copy code” — last path segment of the referral URL
 * (e.g. `ref_jy3z67SP1rtD`), preserving server-provided casing.
 */
export function getOobeSynapseReferralCodeSegment(url: string = getOobeSynapseReferralUrl()): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts.at(-1);
    if (last) return last;
  } catch {
    /* fall through */
  }
  return url;
}
export function getOobeSynapseReferralQrPath(): string {
  if (typeof process === "undefined") return DEFAULT_OOBE_SYNAPSE_REFERRAL_QR_PATH;
  const raw = process.env.NEXT_PUBLIC_OOBE_SYNAPSE_REFERRAL_QR_PATH?.trim();
  if (raw?.startsWith("/")) return raw;
  return DEFAULT_OOBE_SYNAPSE_REFERRAL_QR_PATH;
}