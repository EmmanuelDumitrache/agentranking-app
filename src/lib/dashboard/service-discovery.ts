import { prisma } from "@/lib/db";
import { parseAgentListingFromAgentUri } from "@/lib/parse-agent-uri-listing";
import { fetchRegistrationDocument, registrationDocumentMaxBytes } from "@/lib/registration-document";
import { normalizedAgentServiceData } from "@/lib/agent-service-normalization";
import {
  buildServiceMetadataSnapshot,
  normalizeMetadataItemsInput,
  serializeMetadataStringArray,
  type ServiceMetadataSnapshot,
} from "@/lib/dashboard/service-metadata";
export type DiscoveredServiceRow = {
  name: string;
  endpoint: string;
  version: string;
};
export type ServiceDiscoveryResult = {
  agentUri: string | null;
  source: "registration" | "none";
  services: DiscoveredServiceRow[];
  metadata: ServiceMetadataSnapshot;
  /** Rows in registration not yet stored on the agent. */
  importableServices: DiscoveredServiceRow[];
  /** Metadata keys with registration values missing from stored metadata. */
  importableMetadata: Partial<ServiceMetadataSnapshot>;
  /** Suggested defaults for the add-endpoint form. */
  prefill: {
    mcp: { name: string; endpoint: string; version: string };
    a2a: { name: string; endpoint: string; version: string };
    x402: { name: string; endpoint: string; version: string };
    api: { name: string; endpoint: string; version: string };
  };
};
type RegistrationService = {
  name?: string;
  endpoint?: string;
  version?: string;
  mcpTools?: string[];
  a2aSkills?: string[];
  skills?: string[];
};
function decodeInlineRegistration(agentURI: string): Record<string, unknown> | null {
  const uri = agentURI.trim();
  const dataPrefix = "data:application/json;base64,";
  const maxBytes = registrationDocumentMaxBytes();
  if (uri.startsWith(dataPrefix)) {
    try {
      const encoded = uri.slice(dataPrefix.length);
      if (encoded.length > Math.ceil(maxBytes * 4 / 3) + 16) return null;
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.byteLength > maxBytes) return null;
      const parsed = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (uri.startsWith("{")) {
    try {
      if (Buffer.byteLength(uri, "utf8") > maxBytes) return null;
      const parsed = JSON.parse(uri.replace(/^\uFEFF/, "")) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}
function normalizeRegistrationServices(raw: unknown): RegistrationService[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as RegistrationService[];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      return normalizeRegistrationServices(JSON.parse(trimmed) as unknown);
    } catch {
      return [];
    }
  }
  if (typeof raw === "object") return [raw as RegistrationService];
  return [];
}
function registrationServicesFromPayload(payload: Record<string, unknown>): RegistrationService[] {
  const fromServices = normalizeRegistrationServices(payload.services);
  if (fromServices.length > 0) return fromServices;
  return normalizeRegistrationServices(payload.endpoints);
}
async function fetchRegistrationPayload(agentURI: string): Promise<Record<string, unknown> | null> {
  const inline = decodeInlineRegistration(agentURI);
  if (inline) return inline;
  const parsed = await fetchRegistrationDocument<unknown>(agentURI, { httpsTimeoutMs: 8_000 });
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}
function normalizeDiscoveredService(row: RegistrationService): DiscoveredServiceRow | null {
  const endpoint = row.endpoint?.trim() ?? "";
  if (!endpoint) return null;
  const name = (row.name?.trim() || "CUSTOM").toUpperCase();
  return {
    name,
    endpoint,
    version: row.version?.trim() ?? "",
  };
}
function serviceKey(row: { name: string; endpoint: string }): string {
  return `${row.name.trim().toUpperCase()}|${row.endpoint.trim().toLowerCase()}`;
}
function metadataDiff(
  stored: string[],
  discovered: string[],
): string[] {
  const storedSet = new Set(stored.map((item) => item.toLowerCase()));
  return normalizeMetadataItemsInput(
    discovered.filter((item) => !storedSet.has(item.toLowerCase())),
  );
}
function findService(
  services: DiscoveredServiceRow[],
  name: string,
): DiscoveredServiceRow | undefined {
  const key = name.toUpperCase();
  return services.find((row) => row.name.toUpperCase() === key);
}
export async function discoverAgentServices(agentDbId: number): Promise<ServiceDiscoveryResult> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      agentURI: true,
      services: { select: { name: true, endpoint: true, version: true } },
      metadata: {
        where: { key: { in: ["mcpTools", "a2aSkills", "oasfSkills"] } },
        select: { key: true, value: true },
      },
    },
  });
  const emptyMetadata: ServiceMetadataSnapshot = {
    mcpTools: [],
    a2aSkills: [],
    oasfSkills: [],
  };
  if (!agent) {
    return {
      agentUri: null,
      source: "none",
      services: [],
      metadata: emptyMetadata,
      importableServices: [],
      importableMetadata: {},
      prefill: {
        mcp: { name: "MCP", endpoint: "", version: "" },
        a2a: { name: "A2A", endpoint: "", version: "" },
        x402: { name: "X402", endpoint: "", version: "" },
        api: { name: "API", endpoint: "", version: "" },
      },
    };
  }
  const storedMetadata = buildServiceMetadataSnapshot(agent.metadata);
  const agentUri = agent.agentURI?.trim() || null;
  let discoveredServices: DiscoveredServiceRow[] = [];
  let discoveredMetadata: ServiceMetadataSnapshot = { ...emptyMetadata };
  if (agentUri) {
    const listing = await parseAgentListingFromAgentUri(agentUri);
    if (listing?.services.length) {
      discoveredServices = listing.services.map((row) => ({
        name: row.name.toUpperCase(),
        endpoint: row.endpoint,
        version: "",
      }));
    }
    const payload = await fetchRegistrationPayload(agentUri);
    if (payload) {
      const regServices = registrationServicesFromPayload(payload);
      for (const row of regServices) {
        const normalized = normalizeDiscoveredService(row);
        if (!normalized) continue;
        if (!discoveredServices.some((s) => serviceKey(s) === serviceKey(normalized))) {
          discoveredServices.push(normalized);
        }
      }
      const mcp = regServices.find((s) => (s.name ?? "").toLowerCase() === "mcp");
      const a2a = regServices.find((s) => (s.name ?? "").toLowerCase() === "a2a");
      const oasf = regServices.find((s) => (s.name ?? "").toLowerCase() === "oasf");
      discoveredMetadata = {
        mcpTools: normalizeMetadataItemsInput(mcp?.mcpTools ?? []),
        a2aSkills: normalizeMetadataItemsInput(a2a?.a2aSkills ?? []),
        oasfSkills: normalizeMetadataItemsInput(oasf?.skills ?? []),
      };
    }
  }
  const storedKeys = new Set(agent.services.map((row) => serviceKey(row)));
  const importableServices = discoveredServices.filter((row) => !storedKeys.has(serviceKey(row)));
  const importableMetadata: Partial<ServiceMetadataSnapshot> = {};
  const mcpDiff = metadataDiff(storedMetadata.mcpTools, discoveredMetadata.mcpTools);
  const a2aDiff = metadataDiff(storedMetadata.a2aSkills, discoveredMetadata.a2aSkills);
  const oasfDiff = metadataDiff(storedMetadata.oasfSkills, discoveredMetadata.oasfSkills);
  if (mcpDiff.length > 0) importableMetadata.mcpTools = mcpDiff;
  if (a2aDiff.length > 0) importableMetadata.a2aSkills = a2aDiff;
  if (oasfDiff.length > 0) importableMetadata.oasfSkills = oasfDiff;
  const mcpRow = findService(discoveredServices, "MCP");
  const a2aRow = findService(discoveredServices, "A2A");
  const x402Row =
    findService(discoveredServices, "X402") ??
    discoveredServices.find((row) => row.name.includes("X402"));
  const apiRow =
    findService(discoveredServices, "API") ??
    discoveredServices.find((row) => row.name === "WEB" || row.name === "WEBSITE");
  return {
    agentUri,
    source: discoveredServices.length > 0 || Object.values(discoveredMetadata).some((v) => v.length > 0)
      ? "registration"
      : "none",
    services: discoveredServices,
    metadata: discoveredMetadata,
    importableServices,
    importableMetadata,
    prefill: {
      mcp: { name: "MCP", endpoint: mcpRow?.endpoint ?? "", version: mcpRow?.version ?? "" },
      a2a: { name: "A2A", endpoint: a2aRow?.endpoint ?? "", version: a2aRow?.version ?? "" },
      x402: { name: "X402", endpoint: x402Row?.endpoint ?? "", version: x402Row?.version ?? "" },
      api: { name: "API", endpoint: apiRow?.endpoint ?? "", version: apiRow?.version ?? "" },
    },
  };
}
export async function importDiscoveredAgentServices(
  agentDbId: number,
): Promise<{
  importedServices: number;
  importedMetadataKeys: string[];
}> {
  const discovery = await discoverAgentServices(agentDbId);
  let importedServices = 0;
  for (const row of discovery.importableServices) {
    const normalized = normalizedAgentServiceData(row, { sourceKind: "dashboard-discovery" });
    await prisma.agentService.create({
      data: {
        agentId: agentDbId,
        ...normalized,
        extensions: normalized.extensions as never,
      },
    });
    importedServices += 1;
  }
  const importedMetadataKeys: string[] = [];
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      metadata: {
        where: { key: { in: ["mcpTools", "a2aSkills", "oasfSkills"] } },
        select: { id: true, key: true, value: true },
      },
    },
  });
  const stored = buildServiceMetadataSnapshot(agent?.metadata ?? []);
  for (const key of ["mcpTools", "a2aSkills", "oasfSkills"] as const) {
    const additions = discovery.importableMetadata[key];
    if (!additions?.length) continue;
    const merged = normalizeMetadataItemsInput([...stored[key], ...additions]);
    const value = serializeMetadataStringArray(merged);
    const existing = agent?.metadata.find((row) => row.key === key);
    if (existing) {
      await prisma.agentMetadata.update({ where: { id: existing.id }, data: { value } });
    } else {
      await prisma.agentMetadata.create({ data: { agentId: agentDbId, key, value } });
    }
    importedMetadataKeys.push(key);
  }
  return { importedServices, importedMetadataKeys };
}
