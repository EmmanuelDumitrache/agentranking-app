/** Heuristics for MCP / x402-style resource cards (no schema migration). */
export function mcpOfferCategorySlug(summary: string, title: string): string | null {
  const raw = summary.trim() || title.trim();
  if (!raw) return null;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return slug || null;
}
export function mcpOfferMentionsX402(ctaUrl: string, linkedEndpoint?: string | null): boolean {
  const hay = `${ctaUrl} ${linkedEndpoint ?? ""}`.toLowerCase();
  return (
    hay.includes("x402") ||
    hay.includes("402-payment") ||
    hay.includes("payment-required") ||
    hay.includes("facilitator")
  );
}
/** Snippet for a mono badge: HTTP verb path, URL path, or linked endpoint path. */
export function mcpOfferMethodPathSnippet(ctaUrl: string, linkedEndpoint?: string | null): string | null {
  const c = ctaUrl.trim();
  if (/^(GET|POST|PUT|DELETE|PATCH)\s+\S+/i.test(c)) {
    return c.length > 96 ? `${c.slice(0, 94)}…` : c;
  }
  if (c.startsWith("/") && c.length > 1) {
    return c.length > 96 ? `${c.slice(0, 94)}…` : c;
  }
  if (c) {
    try {
      const normalized = /^https?:\/\//i.test(c) ? c : `https://x.local/${c.replace(/^\//, "")}`;
      const u = new URL(normalized);
      const path = `${u.pathname}${u.search}`;
      if (path.length > 1) {
        const out = path.startsWith("//") ? path.slice(1) : path;
        return out.length > 96 ? `${out.slice(0, 94)}…` : out;
      }
    } catch {
      return c.length > 96 ? `${c.slice(0, 94)}…` : c;
    }
  }
  const le = linkedEndpoint?.trim();
  if (le) {
    try {
      const u = new URL(/^https?:\/\//i.test(le) ? le : `https://x.local/${le.replace(/^\//, "")}`);
      const path = `${u.pathname}${u.search}`;
      if (path.length > 1) {
        const out = path.length > 96 ? `${path.slice(0, 94)}…` : path;
        return out || le.slice(0, 96);
      }
    } catch {
      return le.length > 96 ? `${le.slice(0, 94)}…` : le;
    }
  }
  return null;
}