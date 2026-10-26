import { createHash } from "node:crypto";
import {
  LosslessJsonNumber,
  canonicalLosslessJson,
  decodeJsonBytes,
  isLosslessObject,
  losslessIntegerToken,
  losslessToJsonSafe,
  type LosslessJsonValue,
} from "./lossless-json.js";
import {
  UINT256_MAX,
  canonicalEvmAddress,
  canonicalUint256,
  parseCanonicalUnsignedDecimal,
} from "./exact-protocol.js";
import { boundUtf8String, boundedStringArray } from "./unicode-bounds.js";
import { parseServiceEndpoint, type ParsedServiceEndpoint } from "./service-endpoint.js";
export const REGISTRATION_DECODER_VERSION = "erc8004-registration/3";
export type RegistrationReference = {
  sourceAgentIdToken: string;
  agentId: string;
  sourceAgentRegistry: string;
  namespace: string;
  chainReference: string;
  registryAddress: string;
  canonicalAgentRegistry: string;
};
export type DecodedRegistration = {
  type: string | null;
  name: string | null;
  description: string | null;
  image: string | null;
  services: ParsedServiceEndpoint[];
  registrations: RegistrationReference[];
  declaredActive: boolean | null;
  declaredX402Support: boolean | null;
  declaredMppSupport: boolean | null;
  supportedTrust: string[];
  extensions: Record<string, unknown>;
  rawDocumentDigest: string;
  normalizedFingerprint: string;
  rawBytes: Uint8Array;
  hadBom: boolean;
  truncations: Array<{ field: string; sourceDigest: string; sourceUtf8Bytes: number }>;
};
const CORE_FIELDS = new Set([
  "type",
  "name",
  "description",
  "image",
  "services",
  "endpoints",
  "registrations",
  "active",
  "x402Support",
  "mppSupport",
  "supportedTrust",
]);
function optionalString(
  object: Record<string, LosslessJsonValue>,
  key: string,
  maxBytes: number,
  truncations: DecodedRegistration["truncations"],
): string | null {
  const value = object[key];
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`${key} must be a string when declared`);
  const bounded = boundUtf8String(value, maxBytes, key);
  if (bounded.truncated) {
    truncations.push({ field: key, sourceDigest: bounded.sourceDigest, sourceUtf8Bytes: bounded.sourceUtf8Bytes });
  }
  return bounded.value;
}
function optionalBoolean(object: Record<string, LosslessJsonValue>, key: string): boolean | null {
  if (!(key in object) || object[key] === null) return null;
  if (typeof object[key] !== "boolean") throw new Error(`${key} must be a boolean when declared`);
  return object[key] as boolean;
}
function stringArray(
  object: Record<string, LosslessJsonValue>,
  key: string,
  options: { maxItems: number; maxItemBytes: number },
  truncations: DecodedRegistration["truncations"],
): string[] {
  const value = object[key];
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
  const bounded = boundedStringArray(value as string[], options);
  if (bounded.truncated) {
    truncations.push({ field: key, sourceDigest: bounded.sourceDigest, sourceUtf8Bytes: Buffer.byteLength(JSON.stringify(value), "utf8") });
  }
  return bounded.values;
}
function parseRegistrationReference(value: LosslessJsonValue): RegistrationReference {
  if (!isLosslessObject(value)) throw new Error("registration reference must be an object");
  const agentIdValue = value.agentId;
  const agentRegistryValue = value.agentRegistry;
  if (agentIdValue === undefined) throw new Error("registration reference is missing agentId");
  if (typeof agentRegistryValue !== "string") throw new Error("registration reference agentRegistry must be a string");
  const parts = agentRegistryValue.split(":");
  if (parts.length !== 3) throw new Error("agentRegistry must be namespace:chainReference:registryAddress");
  const [namespaceRaw, chainReferenceRaw, registryRaw] = parts;
  const namespace = namespaceRaw!.trim().toLowerCase();
  const chainReference = chainReferenceRaw!.trim();
  const registrySource = registryRaw!.trim();
  if (!namespace || !chainReference || !registrySource) throw new Error("agentRegistry components must not be empty");
  if (!/^[a-z0-9-]{1,32}$/.test(namespace)) throw new Error("agentRegistry namespace is invalid");
  let token: string;
  let agentId: string;
  let registryAddress: string;
  let canonicalChainReference: string;
  if (namespace === "eip155") {
    token = losslessIntegerToken(agentIdValue, "registration agentId");
    agentId = canonicalUint256(parseCanonicalUnsignedDecimal(token, { max: UINT256_MAX, label: "registration agentId" }));
    canonicalChainReference = parseCanonicalUnsignedDecimal(chainReference, { allowZero: false, label: "agentRegistry chain reference" }).toString(10);
    registryAddress = canonicalEvmAddress(registrySource, "agentRegistry address");
  } else {
    if (typeof agentIdValue !== "string") throw new Error(`${namespace} registration agentId must be a string`);
    token = boundUtf8String(agentIdValue.trim(), 256, "registration agentId").value;
    if (!token) throw new Error("registration agentId must not be empty");
    agentId = token;
    canonicalChainReference = boundUtf8String(chainReference, 128, "agentRegistry chain reference").value;
    registryAddress = boundUtf8String(registrySource, 256, "agentRegistry identifier").value;
  }
  return {
    sourceAgentIdToken: token,
    agentId,
    sourceAgentRegistry: agentRegistryValue,
    namespace,
    chainReference: canonicalChainReference,
    registryAddress,
    canonicalAgentRegistry: `${namespace}:${canonicalChainReference}:${registryAddress}`,
  };
}

function parseServices(root: Record<string, LosslessJsonValue>): ParsedServiceEndpoint[] {
  const raw = root.services ?? root.endpoints;
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length > 1_000) throw new Error("services exceeds cardinality limit");
  return list.map((value, index) => {
    if (!isLosslessObject(value)) throw new Error(`services[${index}] must be an object`);
    const name = value.name;
    const endpoint = value.endpoint;
    const version = value.version;
    if (name != null && typeof name !== "string") throw new Error(`services[${index}].name must be a string`);
    if (endpoint != null && typeof endpoint !== "string") throw new Error(`services[${index}].endpoint must be a string`);
    if (version != null && typeof version !== "string") throw new Error(`services[${index}].version must be a string`);
    const stringList = (key: string): string[] => {
      const item = value[key];
      if (item == null) return [];
      if (!Array.isArray(item) || item.some((entry) => typeof entry !== "string")) throw new Error(`services[${index}].${key} must be an array of strings`);
      return (item as string[]).slice(0, 512);
    };
    const extensions: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, item] of Object.entries(value)) {
      if (!["name", "endpoint", "version", "skills", "domains", "capabilities", "mcpTools", "a2aSkills"].includes(key)) extensions[key] = losslessToJsonSafe(item);
    }
    return parseServiceEndpoint({
      name: typeof name === "string" ? name : "",
      endpoint: typeof endpoint === "string" ? endpoint : "",
      version: typeof version === "string" ? version : null,
      skills: stringList("skills"),
      domains: stringList("domains"),
      capabilities: [...stringList("capabilities"), ...stringList("mcpTools"), ...stringList("a2aSkills")],
      extensions,
    });
  });
}
function normalizeCoreForFingerprint(value: Omit<DecodedRegistration, "rawDocumentDigest" | "normalizedFingerprint" | "rawBytes" | "hadBom" | "truncations">): string {
  return JSON.stringify({
    type: value.type,
    name: value.name,
    description: value.description,
    image: value.image,
    services: value.services.map((service) => ({
      name: service.sourceName,
      type: service.normalizedType,
      endpoint: service.normalizedEndpoint,
      version: service.sourceVersion,
      status: service.validationStatus,
      skills: service.skills,
      domains: service.domains,
      capabilities: service.capabilities,
      extensions: service.extensions,
    })),
    registrations: value.registrations.map((reference) => ({
      agentId: reference.agentId,
      agentRegistry: reference.canonicalAgentRegistry,
    })),
    declaredActive: value.declaredActive,
    declaredX402Support: value.declaredX402Support,
    declaredMppSupport: value.declaredMppSupport,
    supportedTrust: value.supportedTrust,
    extensions: value.extensions,
  });
}
export function decodeRegistrationDocument(
  bytes: Uint8Array,
  expected?: { chainId: number; registryAddress: string; agentId: string | bigint },
): DecodedRegistration {
  const rawDocumentDigest = createHash("sha256").update(bytes).digest("hex");
  const { value, hadBom } = decodeJsonBytes(bytes, {
    maxDepth: 64,
    maxNodes: 100_000,
    maxObjectMembers: 10_000,
    maxArrayItems: 10_000,
  });
  if (!isLosslessObject(value)) throw new Error("registration document root must be an object");
  const identityBearingFields = ["type", "name", "description", "image", "services", "endpoints", "registrations"];
  if (!identityBearingFields.some((key) => key in value)) {
    throw new Error("registration document does not declare any supported identity fields");
  }
  const truncations: DecodedRegistration["truncations"] = [];
  const registrationsValue = value.registrations;
  let registrations: RegistrationReference[] = [];
  if (registrationsValue != null) {
    if (!Array.isArray(registrationsValue)) throw new Error("registrations must be an array");
    registrations = registrationsValue.map(parseRegistrationReference);
  }
  if (expected) {
    const expectedAgentId = canonicalUint256(expected.agentId);
    const expectedRegistry = canonicalEvmAddress(expected.registryAddress).toLowerCase();
    const expectedChain = String(expected.chainId);
    const match = registrations.some((reference) =>
      reference.namespace === "eip155" &&
      reference.agentId === expectedAgentId &&
      reference.chainReference === expectedChain &&
      reference.registryAddress.toLowerCase() === expectedRegistry,
    );
    if (registrations.length > 0 && !match) {
      throw new Error("registration document does not bind to the emitting registry, chain, and agent id");
    }
  }
  const extensions: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(value)) {
    if (!CORE_FIELDS.has(key)) extensions[key] = losslessToJsonSafe(item);
  }
  const core = {
    type: optionalString(value, "type", 256, truncations),
    name: optionalString(value, "name", 512, truncations),
    description: optionalString(value, "description", 16_384, truncations),
    image: optionalString(value, "image", 2_048, truncations),
    services: parseServices(value),
    registrations,
    declaredActive: optionalBoolean(value, "active"),
    declaredX402Support: optionalBoolean(value, "x402Support"),
    declaredMppSupport: optionalBoolean(value, "mppSupport"),
    supportedTrust: stringArray(value, "supportedTrust", { maxItems: 256, maxItemBytes: 256 }, truncations),
    extensions,
  };
  const normalizedFingerprint = createHash("sha256")
    .update(normalizeCoreForFingerprint(core))
    .digest("hex");
  return {
    ...core,
    rawDocumentDigest,
    normalizedFingerprint,
    rawBytes: Uint8Array.from(bytes),
    hadBom,
    truncations,
  };
}
export function losslessJsonDocumentFingerprint(bytes: Uint8Array): string {
  const { value } = decodeJsonBytes(bytes);
  return createHash("sha256").update(canonicalLosslessJson(value)).digest("hex");
}
export function jsonNumberToken(value: unknown): string | null {
  return value instanceof LosslessJsonNumber ? value.token : null;
}
