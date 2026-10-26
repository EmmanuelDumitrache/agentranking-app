export type MetaplexRegistrationInput = {
  name?: string;
  description?: string;
  image?: string;
  type?: string;
  services?: Array<{ name?: string; endpoint?: string; version?: string; skills?: string[]; domains?: string[]; capabilities?: string[]; mcpTools?: string[]; a2aSkills?: string[]; [key: string]: unknown }>;
  endpoints?: Array<{ name?: string; endpoint?: string; version?: string; skills?: string[]; domains?: string[]; capabilities?: string[]; [key: string]: unknown }>;
  registrations?: Array<{ agentId?: unknown; agentRegistry?: unknown; [key: string]: unknown }>;
  x402Support?: boolean | null;
  active?: boolean | null;
  supportedTrust?: string[];
  [key: string]: unknown;
};
export type NormalizedMetaplexRegistration = {
  type: string;
  name: string;
  description: string;
  image: string;
  active: boolean | null;
  x402Support: boolean | null;
  supportedTrust: string[];
  registrations: Array<{ agentId: string; agentRegistry: string; extensions: Record<string, unknown> }>;
  services: Array<{ name: string; endpoint: string; version: string; skills: string[]; domains: string[]; capabilities: string[]; extensions: Record<string, unknown> }>;
};
function sanitize(s: string): string {
  return s.replace(/\0/g, "");
}
function listServiceEntries(reg: MetaplexRegistrationInput | null): Array<{
  name?: string;
  endpoint?: string;
  version?: string;
  skills?: string[];
  domains?: string[];
  capabilities?: string[];
  mcpTools?: string[];
  a2aSkills?: string[];
  [key: string]: unknown;
}> {
  if (!reg) return [];
  if (Array.isArray(reg.services) && reg.services.length > 0) return reg.services;
  if (Array.isArray(reg.endpoints) && reg.endpoints.length > 0) return reg.endpoints;
  return [];
}
export function normalizeMetaplexRegistration(
  reg: MetaplexRegistrationInput | null,
  fallbacks: { assetName?: string; assetUri?: string },
): NormalizedMetaplexRegistration {
  const type = sanitize(typeof reg?.type === "string" ? reg.type.trim() : "");
  const name = sanitize(reg?.name?.trim() || fallbacks.assetName?.trim() || "Metaplex Agent");
  const description = sanitize(reg?.description?.trim() || "");
  const image = sanitize(reg?.image?.trim() || "");
  const active = typeof reg?.active === "boolean" ? reg.active : null;
  const x402Support = typeof reg?.x402Support === "boolean" ? reg.x402Support : null;
  const supportedTrust = Array.isArray((reg as { supportedTrust?: string[] } | null)?.supportedTrust)
    ? (reg as { supportedTrust: string[] }).supportedTrust
        .map((t) => sanitize(String(t).trim()))
        .filter((t) => t.length > 0)
    : [];
  const rawServices = listServiceEntries(reg);
  const services = rawServices.map((s) => {
    const extensions = Object.fromEntries(Object.entries(s).filter(([key]) => !["name", "endpoint", "version", "skills", "domains", "capabilities", "mcpTools", "a2aSkills"].includes(key)));
    const stringList = (...values: unknown[]): string[] => [...new Set(values.flatMap((value) => Array.isArray(value) ? value : []).filter((value): value is string => typeof value === "string").map((value) => sanitize(value.trim())).filter(Boolean))].slice(0, 512);
    return {
      name: sanitize((s.name ?? "WEB").toUpperCase().slice(0, 64)),
      endpoint: sanitize(s.endpoint ?? ""),
      version: sanitize(s.version ?? "1.0"),
      skills: stringList(s.skills),
      domains: stringList(s.domains),
      capabilities: stringList(s.capabilities, s.mcpTools, s.a2aSkills),
      extensions,
    };
  });
  const registrations = Array.isArray(reg?.registrations)
    ? reg.registrations.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const agentId = typeof item.agentId === "string"
          ? sanitize(item.agentId.trim())
          : typeof item.agentId === "number" && Number.isSafeInteger(item.agentId) && item.agentId >= 0
            ? String(item.agentId)
            : typeof item.agentId === "bigint" && item.agentId >= 0n
              ? item.agentId.toString(10)
              : "";
        const agentRegistry = typeof item.agentRegistry === "string" ? sanitize(item.agentRegistry.trim()) : "";
        if (!agentId || !agentRegistry) return [];
        return [{ agentId, agentRegistry, extensions: Object.fromEntries(Object.entries(item).filter(([key]) => !["agentId", "agentRegistry"].includes(key))) }];
      })
    : [];
  return {
    type,
    name,
    description,
    image,
    active,
    x402Support,
    supportedTrust,
    registrations,
    services,
  };
}
