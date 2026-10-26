import { fetchRegistrationDocument, registrationDocumentMaxBytes } from "@/lib/registration-document";
export type AgentUriListing = {
  name: string;
  description: string;
  image: string;
  services: Array<{ name: string; endpoint: string }>;
};
function parseJsonListing(parsed: unknown): AgentUriListing | null {
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;
  const description = typeof row.description === "string" ? row.description : "";
  const image = typeof row.image === "string" ? row.image : "";
  const services = Array.isArray(row.services)
    ? row.services
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const svc = s as Record<string, unknown>;
          const endpoint = typeof svc.endpoint === "string" ? svc.endpoint.trim() : "";
          if (!endpoint) return null;
          const svcName = typeof svc.name === "string" ? svc.name : "CUSTOM";
          return { name: svcName.toUpperCase(), endpoint };
        })
        .filter((s): s is { name: string; endpoint: string } => s !== null)
    : [];
  return { name, description, image, services };
}
function decodeDataUriJson(agentURI: string): unknown | null {
  const uri = agentURI.trim();
  const dataPrefix = "data:application/json;base64,";
  const maxBytes = registrationDocumentMaxBytes();
  if (uri.startsWith(dataPrefix)) {
    try {
      const encoded = uri.slice(dataPrefix.length);
      if (encoded.length > Math.ceil(maxBytes * 4 / 3) + 16) return null;
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.byteLength > maxBytes) return null;
      return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as unknown;
    } catch {
      return null;
    }
  }
  if (uri.startsWith("{")) {
    try {
      if (Buffer.byteLength(uri, "utf8") > maxBytes) return null;
      return JSON.parse(uri.replace(/^\uFEFF/, "")) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}
/** Read name, description, image, and services from an on-chain agentURI. */
export async function parseAgentListingFromAgentUri(
  agentURI: string | null | undefined,
): Promise<AgentUriListing | null> {
  if (!agentURI?.trim()) return null;
  const inline = decodeDataUriJson(agentURI);
  const fromInline = parseJsonListing(inline);
  if (fromInline) return fromInline;
  const remote = await fetchRegistrationDocument<unknown>(agentURI, {
    httpsTimeoutMs: 8_000,
  });
  return parseJsonListing(remote);
}
