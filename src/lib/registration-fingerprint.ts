import { hash } from "node:crypto";
/**
 * Stable hash of on-chain registration fields. Used to skip bumping lastActiveAt
 * when the worker/sync re-fetches identical metadata (honest freshness decay).
 */
export function registrationFingerprint(
  name: string,
  description: string,
  image: string,
  services: readonly { name: string; endpoint: string }[],
  x402Support: boolean
): string {
  const sorted = [...services]
    .map((s) => ({ n: s.name, e: (s.endpoint ?? "").trim() }))
    .sort((a, b) => a.n.localeCompare(b.n) || a.e.localeCompare(b.e));
  return hash(
    "sha256",
    JSON.stringify({ name, description, image, x402Support, svc: sorted }),
    "hex",
  );
}
