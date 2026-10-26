/** Canonical public ranking URL with archetype filter (replaces `/agents/{slug}` hubs). */
export function agentsArchetypeHref(slug: string): string {
  if (slug === "telegram") return "/telegram";
  return `/ranking?archetype=${encodeURIComponent(slug)}`;
}
/** Dedicated Telegram bot directory. */
export function telegramDirectoryHref(query?: Record<string, string>): string {
  if (!query || Object.keys(query).length === 0) return "/telegram";
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const qs = params.toString();
  return qs ? `/telegram?${qs}` : "/telegram";
}
