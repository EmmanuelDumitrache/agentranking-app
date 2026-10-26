/**
 * Merge SAP on-chain snapshot fields into AgentRanking display fields.
 * When `sapVerified`, SAP JSON / columns override self-reported metadata for public display.
 */
export type SapFieldProvenance = {
  readonly nameFromSap: boolean;
  readonly descriptionFromSap: boolean;
  readonly agentURIFromSap: boolean;
  readonly x402FromSap: boolean;
  readonly servicesFromSap: boolean;
};
export type SapMergeMeta = {
  readonly sapVerified: true;
  readonly provenance: SapFieldProvenance;
  /** Display fields merged from a unique Solana SAP listing matched by non-URL identity evidence. */
  readonly viaNameTwin?: boolean;
};
export type SapStatsIdentitySlice = {
  readonly identityName?: string;
  readonly identityDescription?: string;
  readonly identityAgentUri?: string;
  readonly identityIsActive?: boolean;
};
export type AgentServiceLike = {
  id: number;
  name: string;
  endpoint: string;
  version: string;
};
const SAP_SLOT_NAMES = new Set(["X402", "WEB"]);
function sapStatsIdentity(sapStats: unknown): SapStatsIdentitySlice {
  if (sapStats == null || typeof sapStats !== "object") return {};
  const o = sapStats as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const name = str(o.identityName);
  const description = str(o.identityDescription);
  const uri = str(o.identityAgentUri);
  const isActive = typeof o.identityIsActive === "boolean" ? o.identityIsActive : undefined;
  return {
    identityName: name,
    identityDescription: description,
    identityAgentUri: uri,
    identityIsActive: isActive,
  };
}
/** Strip indexer-style synthetic rows; we replace them from SAP columns. */
function servicesWithoutSapSlots(existing: readonly AgentServiceLike[]): AgentServiceLike[] {
  return existing.filter((s) => !SAP_SLOT_NAMES.has(String(s.name).toUpperCase()));
}
/**
 * Rebuild X402 + WEB rows like `replaceServices` in the SAP indexer (uppercase short names).
 */
function buildSapSyntheticServices(
  sapX402Endpoint: string | null | undefined,
  agentURI: string,
): AgentServiceLike[] {
  const out: AgentServiceLike[] = [];
  const x4 = typeof sapX402Endpoint === "string" ? sapX402Endpoint.trim() : "";
  if (x4) {
    out.push({ id: -1, name: "X402", endpoint: x4, version: "1.0" });
  }
  const uri = agentURI.trim();
  if (uri) {
    out.push({ id: -2, name: "WEB", endpoint: uri, version: "1.0" });
  }
  return out;
}
export type SapMergeAgentInput = {
  readonly sapVerified: boolean;
  readonly name: string;
  readonly description: string;
  readonly agentURI: string;
  readonly x402Support: boolean;
  readonly sapX402Endpoint: string | null | undefined;
  readonly sapStats: unknown;
  readonly services: readonly AgentServiceLike[];
};
export type SapMergeAgentOutput = {
  readonly name: string;
  readonly description: string;
  readonly agentURI: string;
  readonly x402Support: boolean;
  readonly services: AgentServiceLike[];
  readonly sapMergeMeta: SapMergeMeta | null;
};
/**
 * Apply SAP-as-source-of-truth for listing/detail display fields.
 */
export function mergeSapVerifiedAgentRecord(input: SapMergeAgentInput): SapMergeAgentOutput {
  if (!input.sapVerified) {
    return {
      name: input.name,
      description: input.description,
      agentURI: input.agentURI,
      x402Support: input.x402Support,
      services: [...input.services],
      sapMergeMeta: null,
    };
  }
  const snap = sapStatsIdentity(input.sapStats);
  const nameFromSap = Boolean(snap.identityName);
  const descriptionFromSap = Boolean(snap.identityDescription);
  const agentURIFromSap = Boolean(snap.identityAgentUri);
  const x402FromSap = Boolean(
    typeof input.sapX402Endpoint === "string" && input.sapX402Endpoint.trim(),
  );
  const name = snap.identityName ?? input.name;
  const description = snap.identityDescription ?? input.description;
  const agentURI = snap.identityAgentUri ?? input.agentURI;
  const synthetic = buildSapSyntheticServices(input.sapX402Endpoint, agentURI);
  const servicesFromSap = synthetic.length > 0;
  const mergedServices = [...synthetic, ...servicesWithoutSapSlots(input.services)];
  const x402Support = Boolean(x402FromSap || input.x402Support);
  return {
    name,
    description,
    agentURI,
    x402Support,
    services: mergedServices,
    sapMergeMeta: {
      sapVerified: true,
      provenance: {
        nameFromSap,
        descriptionFromSap,
        agentURIFromSap,
        x402FromSap,
        servicesFromSap,
      },
    },
  };
}
/** SEO payload: merged name/description/x402 only (no service rows). */
export function mergeSapSeoFields(
  row: Pick<
    SapMergeAgentInput,
    "sapVerified" | "name" | "description" | "agentURI" | "x402Support" | "sapX402Endpoint" | "sapStats"
  >,
): Pick<SapMergeAgentOutput, "name" | "description" | "x402Support"> {
  const m = mergeSapVerifiedAgentRecord({ ...row, services: [] });
  return { name: m.name, description: m.description, x402Support: m.x402Support };
}
