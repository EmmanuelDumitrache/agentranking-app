/**
 * Maximum OFFSET (`(page - 1) * perPage`) accepted by public Agent-list routes.
 * This is a query-safety policy, not a cache setting.
 */
export function resolveAgentsListMaxSkip(): number {
  const raw = Number.parseInt(process.env.AGENTS_LIST_MAX_SKIP ?? "10000", 10);
  if (!Number.isFinite(raw) || raw < 500) return 10_000;
  return Math.min(raw, 500_000);
}
