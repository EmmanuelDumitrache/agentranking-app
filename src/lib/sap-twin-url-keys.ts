/** Client-safe URL normalization for SAP / ERC twin matching (no DB). */
export type TwinMatchAgentShape = {
  readonly agentURI?: string | null;
  readonly sapX402Endpoint?: string | null;
  readonly services?: ReadonlyArray<{ name: string; endpoint: string }>;
};
/** Normalize to `host/lowercase-path` for cross-registry URL matching. */
export function normalizeAgentListingUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^(ipfs|ipns|ar|blob):/i.test(t)) return null;
  try {
    const withProto = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.replace(/\/$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return null;
  }
}
export function collectUrlKeysForTwinMatch(agent: TwinMatchAgentShape): string[] {
  const keys = new Set<string>();
  const add = (s: string | null | undefined) => {
    const k = normalizeAgentListingUrl(s);
    if (k) keys.add(k);
  };
  add(agent.agentURI);
  add(agent.sapX402Endpoint);
  for (const s of agent.services ?? []) {
    const n = String(s.name ?? "").toUpperCase();
    if (
      n === "WEB" ||
      n === "X402" ||
      n === "MCP" ||
      n.includes("402") ||
      n.includes("X402-DISCOVERY")
    ) {
      add(s.endpoint);
    }
  }
  return [...keys];
}
