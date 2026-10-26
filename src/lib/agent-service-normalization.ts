export type AgentServiceEndpointKind =
  | "https"
  | "ipfs"
  | "ipns"
  | "arweave"
  | "did"
  | "ens"
  | "email"
  | "chain_account"
  | "solana_address"
  | "opaque";

export type NormalizedAgentService = {
  sourceName: string;
  normalizedType: string;
  sourceEndpoint: string;
  endpointKind: AgentServiceEndpointKind;
  normalizedEndpoint: string | null;
  sourceVersion: string | null;
  validationStatus: "valid" | "unsupported" | "invalid";
  validationReason: string | null;
  skills: string[];
  domains: string[];
  capabilities: string[];
  extensions: Record<string, unknown>;
  truncated: boolean;
};

const ENS_RE = /^(?:[a-z0-9-]+\.)+eth$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DID_RE = /^did:([a-z0-9]+):(.+)$/i;
const CAIP_ACCOUNT_RE = /^([a-z0-9-]+):([^:]+):(.+)$/i;
const EVM_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TYPE_ALIASES: Record<string, string> = {
  "a-2-a": "a2a",
  "agent-to-agent": "a2a",
  "model-context-protocol": "mcp",
  "payment": "x402",
  "payments": "x402",
  "registration-document": "web",
  "website": "web",
  "world-wide-web": "web",
};

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function boundedUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  if (utf8Bytes(value) <= maxBytes) return { value, truncated: false };
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8Bytes(value.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return { value: value.slice(0, low), truncated: true };
}

function normalizedType(value: string): string {
  const normalized = value
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return TYPE_ALIASES[normalized] ?? (normalized || "service");
}

function normalizedStrings(values: readonly unknown[] | undefined, label: string): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of values) {
    if (typeof item !== "string") continue;
    const bounded = boundedUtf8(item.trim().normalize("NFC"), 512).value;
    const key = bounded.toLocaleLowerCase("en-US");
    if (!bounded || seen.has(key)) continue;
    seen.add(key);
    output.push(bounded);
    if (output.length >= 512) break;
  }
  void label;
  return output;
}

function normalizeHttps(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return null;
  }
}

function canonicalEvmAddress(value: string): string | null {
  return EVM_ADDRESS_RE.test(value) ? value.toLowerCase() : null;
}

function normalizeChainAccount(value: string): string | null {
  const match = CAIP_ACCOUNT_RE.exec(value);
  if (!match) return null;
  const namespace = match[1]!.toLowerCase();
  const reference = match[2]!.trim();
  const account = match[3]!.trim();
  if (namespace === "eip155") {
    if (!/^[1-9][0-9]*$/.test(reference)) return null;
    const address = canonicalEvmAddress(account);
    if (!address) return null;
    return `eip155:${BigInt(reference).toString(10)}:${address}`;
  }
  if (namespace === "solana") {
    if (!reference || !SOLANA_ADDRESS_RE.test(account)) return null;
    return `solana:${reference}:${account}`;
  }
  return `${namespace}:${reference}:${account}`;
}

function classifyEndpoint(sourceEndpoint: string): Pick<NormalizedAgentService, "endpointKind" | "normalizedEndpoint" | "validationStatus" | "validationReason"> {
  const https = normalizeHttps(sourceEndpoint);
  if (https) return { endpointKind: "https", normalizedEndpoint: https, validationStatus: "valid", validationReason: null };
  if (/^ipfs:\/\//i.test(sourceEndpoint)) return { endpointKind: "ipfs", normalizedEndpoint: sourceEndpoint, validationStatus: "valid", validationReason: null };
  if (/^ipns:\/\//i.test(sourceEndpoint)) return { endpointKind: "ipns", normalizedEndpoint: sourceEndpoint, validationStatus: "valid", validationReason: null };
  if (/^ar:\/\//i.test(sourceEndpoint)) return { endpointKind: "arweave", normalizedEndpoint: sourceEndpoint, validationStatus: "valid", validationReason: null };
  if (DID_RE.test(sourceEndpoint)) return { endpointKind: "did", normalizedEndpoint: sourceEndpoint, validationStatus: "valid", validationReason: null };
  if (ENS_RE.test(sourceEndpoint)) return { endpointKind: "ens", normalizedEndpoint: sourceEndpoint.toLowerCase(), validationStatus: "valid", validationReason: null };
  if (EMAIL_RE.test(sourceEndpoint)) return { endpointKind: "email", normalizedEndpoint: sourceEndpoint, validationStatus: "valid", validationReason: null };
  const account = normalizeChainAccount(sourceEndpoint);
  if (account) return { endpointKind: "chain_account", normalizedEndpoint: account, validationStatus: "valid", validationReason: null };
  if (SOLANA_ADDRESS_RE.test(sourceEndpoint)) return { endpointKind: "solana_address", normalizedEndpoint: sourceEndpoint, validationStatus: "valid", validationReason: null };
  return {
    endpointKind: "opaque",
    normalizedEndpoint: sourceEndpoint || null,
    validationStatus: sourceEndpoint ? "unsupported" : "invalid",
    validationReason: sourceEndpoint ? "unrecognized-endpoint-scheme" : "empty-endpoint",
  };
}

export function normalizeAgentService(input: {
  name: string;
  endpoint: string;
  version?: string | null;
  skills?: readonly unknown[];
  domains?: readonly unknown[];
  capabilities?: readonly unknown[];
  extensions?: Record<string, unknown> | null;
}): NormalizedAgentService {
  const boundedName = boundedUtf8(input.name.trim().normalize("NFC"), 128);
  const boundedEndpoint = boundedUtf8(input.endpoint.trim().normalize("NFC"), 2_048);
  const boundedVersion = input.version == null
    ? null
    : boundedUtf8(input.version.trim().normalize("NFC"), 128);
  const classification = classifyEndpoint(boundedEndpoint.value);
  const truncated = boundedName.truncated || boundedEndpoint.truncated || Boolean(boundedVersion?.truncated);
  return {
    sourceName: boundedName.value,
    normalizedType: normalizedType(boundedName.value),
    sourceEndpoint: boundedEndpoint.value,
    endpointKind: classification.endpointKind,
    normalizedEndpoint: classification.normalizedEndpoint,
    sourceVersion: boundedVersion?.value || null,
    validationStatus: truncated ? "invalid" : classification.validationStatus,
    validationReason: truncated ? "service-field-exceeded-byte-limit" : classification.validationReason,
    skills: normalizedStrings(input.skills, "skill"),
    domains: normalizedStrings(input.domains, "domain"),
    capabilities: normalizedStrings(input.capabilities, "capability"),
    extensions: input.extensions && typeof input.extensions === "object" && !Array.isArray(input.extensions)
      ? input.extensions
      : {},
    truncated,
  };
}

export function normalizedAgentServiceData(
  input: Parameters<typeof normalizeAgentService>[0],
  options: { sourceKind: string; sourceDigest?: string | null } = { sourceKind: "application" },
): {
  name: string;
  endpoint: string;
  version: string;
  sourceName: string;
  normalizedType: string;
  sourceEndpoint: string;
  endpointKind: AgentServiceEndpointKind;
  endpointValid: boolean;
  sourceVersion: string | null;
  sourceDigest: string | null;
  sourceKind: string;
  skills: string[];
  domains: string[];
  capabilities: string[];
  extensions: Record<string, unknown>;
} {
  const normalized = normalizeAgentService(input);
  return {
    name: normalized.sourceName,
    endpoint: normalized.normalizedEndpoint ?? normalized.sourceEndpoint,
    version: normalized.sourceVersion ?? "",
    sourceName: normalized.sourceName,
    normalizedType: normalized.normalizedType,
    sourceEndpoint: normalized.sourceEndpoint,
    endpointKind: normalized.endpointKind,
    endpointValid: normalized.validationStatus === "valid",
    sourceVersion: normalized.sourceVersion,
    sourceDigest: options.sourceDigest ?? null,
    sourceKind: options.sourceKind,
    skills: normalized.skills,
    domains: normalized.domains,
    capabilities: normalized.capabilities,
    extensions: {
      ...normalized.extensions,
      normalization: {
        status: normalized.validationStatus,
        reason: normalized.validationReason,
        truncated: normalized.truncated,
      },
    },
  };
}
