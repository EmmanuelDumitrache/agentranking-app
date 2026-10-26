import type { NextRequest } from "next/server";
function firstForwarded(forwarded: string | null): string | null {
  if (!forwarded) return null;
  const first = forwarded.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}
/** Best-effort client IP from proxy headers (Cloudflare, nginx, or another trusted proxy). */
export function getClientIp(request: NextRequest | Request): string | null {
  const h = request.headers;
  const fromXff = firstForwarded(h.get("x-forwarded-for"));
  if (fromXff) return fromXff;
  const realIp = h.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return null;
}