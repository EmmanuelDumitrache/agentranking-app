import { hash } from "node:crypto";
import { boundUtf8String, boundedStringArray } from "../lib/unicode-bounds.js";
export type ServiceEntry = {
  name?: string;
  endpoint?: string;
  version?: string;
  skills?: string[];
  domains?: string[];
  mcpTools?: string[];
  a2aSkills?: string[];
  capabilities?: string[];
  extensions?: Record<string, unknown>;
  normalizedType?: string;
  endpointKind?: string;
  normalizedEndpoint?: string | null;
  validationStatus?: string;
};
export type RegistrationJson = {
  type?: string;
  name?: string;
  description?: string;
  image?: string;
  services?: ServiceEntry[];
  endpoints?: ServiceEntry[];
  x402Support?: boolean | null;
  mppSupport?: boolean | null;
  supportedTrust?: string[];
  active?: boolean | null;
  updatedAt?: string;
  registrations?: Array<{
    agentId?: string;
    agentRegistry?: string;
    canonicalAgentRegistry?: string;
    chainId?: string;
    registryAddress?: string;
  }>;
  banner?: string;
  website?: string;
  uri?: string;
  url?: string;
  twitter?: string;
  x?: string;
  github?: string;
  discord?: string;
  telegram?: string;
  tokenAddress?: string;
  staked?: string;
  tee?: boolean;
  supportsERC8211?: boolean;
  medusaPassportSupported?: boolean;
  medusaPassportUseCase?: string;
  medusaMinTier?: string;
  customTags?: string | string[];
  mcpTools?: string[];
  a2aSkills?: string[];
  oasfSkills?: string[];
  oasfDomains?: string[];
  binanceSkills?: string[];
  extensions?: Record<string, unknown>;
  rawDocumentDigest?: string;
  normalizedFingerprint?: string;
  decoderVersion?: string;
};
function normalizeServiceList(raw: unknown): ServiceEntry[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((entry): entry is ServiceEntry => entry != null && typeof entry === "object");
  if (typeof raw === "object") return [raw as ServiceEntry];
  return [];
}
export function listServiceEntries(reg: RegistrationJson | null): ServiceEntry[] {
  if (!reg) return [];
  const fromServices = normalizeServiceList(reg.services);
  const source = fromServices.length > 0 ? fromServices : normalizeServiceList(reg.endpoints);
  const canonical = new Map<string, ServiceEntry>();
  for (const service of source) {
    const type = (service.normalizedType ?? service.name ?? "").trim().toLowerCase();
    const endpoint = (service.normalizedEndpoint ?? service.endpoint ?? "").trim();
    const version = (service.version ?? "").trim();
    const identity = `${type}\0${endpoint}\0${version}`;
    if (!canonical.has(identity)) canonical.set(identity, service);
  }
  const identities = [...canonical.keys()].sort((left, right) => left.localeCompare(right));
  const ordered = new Array<ServiceEntry>(identities.length);
  for (let index = 0; index < identities.length; index++) {
    ordered[index] = canonical.get(identities[index]!)!;
  }
  return ordered;
}
function sanitizeForPostgres(value: string): string {
  return value.replace(/\0/g, "");
}
function bounded(value: string, maxBytes: number, label: string): string {
  return sanitizeForPostgres(boundUtf8String(value, maxBytes, label).value);
}
function pushStringMeta(
  entries: Array<{ key: string; value: string }>,
  key: string,
  raw: unknown,
  maxBytes = 4_000,
): void {
  if (typeof raw !== "string") return;
  const value = bounded(raw.trim(), maxBytes, key);
  if (value) entries.push({ key, value });
}
function mergeUniqueStrings(...groups: Array<string[] | undefined>): string[] {
  const values: string[] = [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) if (typeof item === "string" && item.trim()) values.push(item.trim());
  }
  return boundedStringArray(values, { maxItems: 1_000, maxItemBytes: 512 }).values;
}
export function boundedStructuredJson(value: unknown, maxBytes = 16_000): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) throw new Error("structured JSON maxBytes must be a safe integer of at least 256");
  const serialized = JSON.stringify(value);
  const sourceBytes = Buffer.byteLength(serialized, "utf8");
  if (sourceBytes <= maxBytes) return serialized;
  const summary = JSON.stringify({
    truncated: true,
    sourceDigest: hash("sha256", serialized, "hex"),
    sourceUtf8Bytes: sourceBytes,
  });
  if (Buffer.byteLength(summary, "utf8") > maxBytes) throw new Error("structured JSON truncation summary exceeds maxBytes");
  return summary;
}
function pushJsonArrayMeta(entries: Array<{ key: string; value: string }>, key: string, values: string[]): void {
  if (values.length > 0) entries.push({ key, value: boundedStructuredJson(values) });
}
export function extractMetadata(
  reg: RegistrationJson | null,
  onChainAgentWallet: string | null,
): Array<{ key: string; value: string }> {
  if (!reg) return [];
  const entries: Array<{ key: string; value: string }> = [];
  const services = listServiceEntries(reg);
  const verifiedWallet = onChainAgentWallet && onChainAgentWallet !== "0x0000000000000000000000000000000000000000"
    ? onChainAgentWallet
    : "";
  const declaredWallet = services.find((service) => service.normalizedType === "agentwallet" || service.name?.toLowerCase() === "agentwallet")?.endpoint ?? "";
  if (!verifiedWallet && declaredWallet) {
    const address = declaredWallet.startsWith("eip155:") ? declaredWallet.split(":").at(-1) ?? declaredWallet : declaredWallet;
    pushStringMeta(entries, "declaredAgentWallet", address, 256);
  }
  if (reg.updatedAt != null) pushStringMeta(entries, "declaredUpdatedAt", reg.updatedAt, 128);
  if (reg.active !== undefined && reg.active !== null) entries.push({ key: "declaredActive", value: String(reg.active) });
  if (reg.x402Support !== undefined && reg.x402Support !== null) entries.push({ key: "declaredX402Support", value: String(reg.x402Support) });
  if (reg.mppSupport !== undefined && reg.mppSupport !== null) entries.push({ key: "declaredMppSupport", value: String(reg.mppSupport) });
  pushStringMeta(entries, "type", reg.type, 256);
  if (reg.registrations?.length) entries.push({ key: "registrations", value: boundedStructuredJson(reg.registrations) });
  for (const key of ["banner", "website", "uri", "url", "twitter", "x", "github", "discord", "telegram"] as const) {
    pushStringMeta(entries, key, reg[key]);
  }
  pushStringMeta(entries, "tokenAddress", reg.tokenAddress, 256);
  pushStringMeta(entries, "staked", reg.staked, 1_024);
  if (reg.tee === true) entries.push({ key: "tee", value: "true" });
  if (reg.supportsERC8211 === true) entries.push({ key: "supportsERC8211", value: "true" });
  if (reg.medusaPassportSupported === true) entries.push({ key: "medusaPassportSupported", value: "true" });
  pushStringMeta(entries, "medusaPassportUseCase", reg.medusaPassportUseCase, 128);
  pushStringMeta(entries, "medusaMinTier", reg.medusaMinTier, 64);
  if (reg.customTags != null) {
    if (Array.isArray(reg.customTags)) pushJsonArrayMeta(entries, "customTags", mergeUniqueStrings(reg.customTags));
    else pushStringMeta(entries, "customTags", reg.customTags, 2_000);
  }
  pushJsonArrayMeta(entries, "mcpTools", mergeUniqueStrings(reg.mcpTools, ...services.map((service) => service.mcpTools)));
  pushJsonArrayMeta(entries, "a2aSkills", mergeUniqueStrings(reg.a2aSkills, ...services.map((service) => service.a2aSkills)));
  pushJsonArrayMeta(entries, "serviceCapabilities", mergeUniqueStrings(...services.map((service) => service.capabilities)));
  pushJsonArrayMeta(entries, "oasfSkills", mergeUniqueStrings(reg.oasfSkills, ...services.map((service) => service.skills)));
  pushJsonArrayMeta(entries, "oasfDomains", mergeUniqueStrings(reg.oasfDomains, ...services.map((service) => service.domains)));
  pushJsonArrayMeta(entries, "binanceSkills", mergeUniqueStrings(reg.binanceSkills));
  if (reg.extensions && Object.keys(reg.extensions).length > 0) {
    entries.push({ key: "erc8004RegistrationExtensions", value: boundedStructuredJson(reg.extensions) });
  }
  if (reg.rawDocumentDigest) entries.push({ key: "registrationRawDigest", value: reg.rawDocumentDigest });
  if (reg.normalizedFingerprint) entries.push({ key: "registrationSemanticFingerprint", value: reg.normalizedFingerprint });
  if (reg.decoderVersion) entries.push({ key: "registrationDecoderVersion", value: reg.decoderVersion });
  const canonical = new Map<string, { key: string; value: string }>();
  for (const entry of entries) {
    const comparisonKey = entry.key.trim().normalize("NFC").toLocaleLowerCase("en-US");
    // First writer wins so worker-reserved fields cannot be displaced by later extensions.
    if (!canonical.has(comparisonKey)) canonical.set(comparisonKey, entry);
  }
  // Every materializer canonicalizes its final relation fingerprint after adding
  // source-owned fields. Sorting here only made the same metadata pay twice.
  return [...canonical.values()];
}
