/**
 * Capability ids: `namespace:method` (spec) or dotted ids from reference manifests (e.g. audit.verify).
 */
export const CAPABILITY_ID_RE = /^[A-Za-z0-9_.-]+([.:][A-Za-z0-9_.-]+)+$/;
export type CapabilityLike = {
  id?: string | null;
};
export function parseSapCapabilities(raw: unknown): CapabilityLike[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is CapabilityLike => x != null && typeof x === "object");
}
export function validateCapabilityIds(capabilities: CapabilityLike[]): {
  ok: boolean;
  invalidIds: string[];
} {
  const invalidIds: string[] = [];
  for (const c of capabilities) {
    const id = typeof c.id === "string" ? c.id.trim() : "";
    if (!id) {
      invalidIds.push("(empty)");
      continue;
    }
    if (!CAPABILITY_ID_RE.test(id)) invalidIds.push(id);
  }
  return { ok: invalidIds.length === 0, invalidIds };
}