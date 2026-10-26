import { createHash } from "node:crypto";
import { getOrLoadValkeyJson } from "@/lib/valkey-cache";
import type { RegistrationJson, ServiceEntry } from "../sync/agent-metadata.js";
import { fetchIpfsBytes, isIpfsReference, parseIpfsReference, type IpfsByteResponse } from "./ipfs-rpc.js";
import { fetchPublicBytes } from "./public-json.js";
import { throwIfAborted } from "./abort.js";
import { redactSensitiveText } from "./secret-redaction.js";
import { prismaJson } from "./prisma-json.js";
import { parseOptionalStrictUnsignedInteger } from "./strict-integer.js";
import { prisma } from "../db.js";
import {
  REGISTRATION_DECODER_VERSION,
  decodeRegistrationDocument,
  type DecodedRegistration,
} from "./registration-decoder.js";
const MAX_BYTES = Math.min(
  16_777_216,
  Math.max(
    1_024,
    parseOptionalStrictUnsignedInteger(
      process.env.REGISTRATION_JSON_MAX_BYTES ?? process.env.IPFS_RPC_MAX_RESPONSE_BYTES,
      "REGISTRATION_JSON_MAX_BYTES",
      1_048_576,
      { maximum: 16_777_216 },
    ),
  ),
);
const INLINE_MAX_BYTES = Math.min(
  MAX_BYTES,
  Math.max(1_024, parseOptionalStrictUnsignedInteger(process.env.REGISTRATION_DATA_URI_MAX_BYTES, "REGISTRATION_DATA_URI_MAX_BYTES", 65_536, { maximum: 16_777_216 })),
);
export type RegistrationTransportMetadata = {
  sourceUri: string;
  normalizedUri: string;
  retrievalMethod: "data-uri" | "https" | "cat" | "dag-get";
  contentType: string | null;
  immutable: boolean;
  sourceContentAddress: string | null;
  cidVersion: number | null;
  cidCodec: number | null;
  cidMultihashCode: number | null;
  cidDigest: string | null;
  ipfsPath: string | null;
};
export type RegistrationDocumentResult = {
  registration: RegistrationJson;
  decoded: DecodedRegistration;
  transport: RegistrationTransportMetadata;
};
type SerializedRegistrationDocumentResult = Omit<RegistrationDocumentResult, "decoded"> & {
  decoded: Omit<DecodedRegistration, "rawBytes"> & { rawBytesBase64: string };
};
type RegistrationCacheEntry =
  | { kind: "success"; value: SerializedRegistrationDocumentResult; transport: "ipfs" | "https" | "data" }
  | { kind: "negative"; message: string; permanent: boolean; transport: "ipfs" | "https" | "data" };
const registrationInFlight = new Map<string, Promise<RegistrationCacheEntry>>();
function serializeRegistrationResult(
  value: RegistrationDocumentResult,
): SerializedRegistrationDocumentResult {
  const { rawBytes, ...decoded } = value.decoded;
  return {
    ...value,
    decoded: {
      ...decoded,
      rawBytesBase64: Buffer.isBuffer(rawBytes)
        ? rawBytes.toString("base64")
        : Buffer.from(rawBytes).toString("base64"),
    },
  };
}
function deserializeRegistrationResult(
  value: SerializedRegistrationDocumentResult,
): RegistrationDocumentResult {
  const { rawBytesBase64, ...decoded } = value.decoded;
  return {
    ...value,
    decoded: {
      ...decoded,
      rawBytes: Buffer.from(rawBytesBase64, "base64"),
    },
  };
}
function isRegistrationCacheEntry(value: unknown): value is RegistrationCacheEntry {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.transport !== "ipfs" && row.transport !== "https" && row.transport !== "data") {
    return false;
  }
  if (row.kind === "negative") {
    return typeof row.message === "string" && row.message.length <= 4_000 && typeof row.permanent === "boolean";
  }
  if (row.kind !== "success" || row.value == null || typeof row.value !== "object" || Array.isArray(row.value)) {
    return false;
  }
  const result = row.value as Record<string, unknown>;
  if (result.registration == null || typeof result.registration !== "object" || Array.isArray(result.registration)) {
    return false;
  }
  if (result.transport == null || typeof result.transport !== "object" || Array.isArray(result.transport)) {
    return false;
  }
  if (result.decoded == null || typeof result.decoded !== "object" || Array.isArray(result.decoded)) {
    return false;
  }
  const decoded = result.decoded as Record<string, unknown>;
  if (
    typeof decoded.rawBytesBase64 !== "string" ||
    decoded.rawBytesBase64.length > Math.ceil(MAX_BYTES * 4 / 3) + 16 ||
    typeof decoded.rawDocumentDigest !== "string" ||
    typeof decoded.normalizedFingerprint !== "string" ||
    decoded.decoderVersion !== undefined
  ) {
    return false;
  }
  try {
    return Buffer.from(decoded.rawBytesBase64, "base64").byteLength <= MAX_BYTES;
  } catch {
    return false;
  }
}
const mutableRegistrationCacheTtlSeconds = Math.max(1, parseOptionalStrictUnsignedInteger(
  process.env.WORKER_MUTABLE_REGISTRATION_REFRESH_SECONDS,
  "WORKER_MUTABLE_REGISTRATION_REFRESH_SECONDS",
  60 * 60,
  { maximum: 30 * 24 * 60 * 60 },
));

function registrationCacheTtlSeconds(entry: RegistrationCacheEntry): number {
  if (entry.kind === "success") {
    return entry.transport === "https" ? mutableRegistrationCacheTtlSeconds : 24 * 60 * 60;
  }
  if (entry.permanent) return 6 * 60 * 60;
  return 30;
}
function defensiveCopy(value: RegistrationDocumentResult): RegistrationDocumentResult {
  return structuredClone(value);
}
function expectedCacheSuffix(expected?: { chainId: number; registryAddress: string; agentId: string | bigint }): string {
  return expected == null ? "unbound" : `${expected.chainId}:${expected.registryAddress.toLowerCase()}:${String(expected.agentId)}`;
}
export function normalizeRegistrationUri(uri: string): { key: string; transport: "ipfs" | "https" | "data"; immutable: boolean; contentAddress: string | null } {
  const trimmed = uri.trim();
  if (trimmed.startsWith("data:")) {
    const parsed = parseRegistrationDataUri(trimmed);
    return { key: `data:sha256:${createHash("sha256").update(parsed.bytes).digest("hex")}`, transport: "data", immutable: true, contentAddress: null };
  }
  if (isIpfsReference(trimmed)) {
    const parsed = parseIpfsReference(trimmed);
    return { key: parsed.normalizedUri, transport: "ipfs", immutable: true, contentAddress: parsed.canonicalCid };
  }
  const url = new URL(trimmed);
  if (url.protocol !== "https:") throw new Error("registration URI must use HTTPS, IPFS, or data");
  url.hash = "";
  return { key: url.toString(), transport: "https", immutable: false, contentAddress: null };
}
export function permanentRegistrationFailure(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /invalid ipfs cid|malformed|duplicate json|invalid utf-8|unsupported .*media type|schema|registration reference|exceeds .*bytes|unsafe|fractional|uint256/.test(message);
}
function strictBase64(payload: string): Uint8Array {
  if (/\s/.test(payload)) throw new Error("base64 data URI must not contain whitespace");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
    throw new Error("data URI contains malformed base64");
  }
  const bytes = Buffer.from(payload, "base64");
  if (bytes.toString("base64") !== payload) throw new Error("data URI base64 is not canonical");
  return bytes;
}
function strictPercentBytes(payload: string): Uint8Array {
  const bytes = new Uint8Array(payload.length);
  let length = 0;
  for (let index = 0; index < payload.length;) {
    const char = payload[index]!;
    if (char === "%") {
      const token = payload.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(token)) throw new Error("data URI has malformed percent encoding");
      bytes[length] = Number.parseInt(token, 16);
      length += 1;
      index += 3;
      continue;
    }
    const code = char.charCodeAt(0);
    if (code > 0x7f) throw new Error("non-ASCII data URI octets must be percent encoded");
    bytes[length] = code;
    length += 1;
    index += 1;
  }
  return bytes.subarray(0, length);
}
export function parseRegistrationDataUri(uri: string): { bytes: Uint8Array; contentType: string } {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("data URI is missing payload separator");
  const metadata = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const parts = metadata.split(";");
  const mediaType = (parts.shift() || "text/plain").toLowerCase();
  if (mediaType !== "application/json" && mediaType !== "application/ld+json") {
    throw new Error(`unsupported data URI media type ${mediaType}`);
  }
  let base64 = false;
  for (const part of parts) {
    if (!part) throw new Error("empty data URI media parameter");
    if (part.toLowerCase() === "base64") {
      if (base64) throw new Error("duplicate data URI base64 marker");
      base64 = true;
      continue;
    }
    if (!/^[!#$&^_.+\-0-9A-Za-z]+=(?:[!#$&^_.+\-0-9A-Za-z]+|"[^"]*")$/.test(part)) {
      throw new Error("invalid data URI media parameter");
    }
  }
  const bytes = base64 ? strictBase64(payload) : strictPercentBytes(payload);
  if (bytes.byteLength > INLINE_MAX_BYTES) throw new Error(`inline registration exceeds ${INLINE_MAX_BYTES} bytes`);
  return { bytes, contentType: metadata || mediaType };
}
function extensionString(decoded: DecodedRegistration, key: string): string | undefined {
  const value = decoded.extensions[key];
  return typeof value === "string" ? value : undefined;
}
function extensionBoolean(decoded: DecodedRegistration, key: string): boolean | undefined {
  const value = decoded.extensions[key];
  return typeof value === "boolean" ? value : undefined;
}
function extensionStrings(decoded: DecodedRegistration, key: string): string[] | undefined {
  const value = decoded.extensions[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : undefined;
}
function toRegistrationJson(decoded: DecodedRegistration): RegistrationJson {
  const services: ServiceEntry[] = decoded.services.map((service) => ({
    name: service.sourceName || undefined,
    endpoint: service.sourceEndpoint || undefined,
    version: service.sourceVersion ?? undefined,
    normalizedType: service.normalizedType,
    endpointKind: service.endpointKind,
    normalizedEndpoint: service.normalizedEndpoint,
    validationStatus: service.validationStatus,
    skills: service.skills,
    domains: service.domains,
    capabilities: service.capabilities,
    extensions: service.extensions,
  }));
  const declaredUpdatedAt = decoded.extensions.updatedAt;
  const updatedAt = typeof declaredUpdatedAt === "string"
    ? declaredUpdatedAt
    : declaredUpdatedAt && typeof declaredUpdatedAt === "object" && "$number" in declaredUpdatedAt
      ? String((declaredUpdatedAt as { $number: unknown }).$number)
      : undefined;
  return {
    type: decoded.type ?? undefined,
    name: decoded.name ?? undefined,
    description: decoded.description ?? undefined,
    image: decoded.image ?? undefined,
    services,
    x402Support: decoded.declaredX402Support,
    mppSupport: decoded.declaredMppSupport,
    supportedTrust: decoded.supportedTrust,
    active: decoded.declaredActive,
    updatedAt,
    registrations: decoded.registrations.map((reference) => ({
      agentId: reference.agentId,
      agentRegistry: reference.sourceAgentRegistry,
      canonicalAgentRegistry: reference.canonicalAgentRegistry,
      chainId: reference.chainReference,
      registryAddress: reference.registryAddress,
    })),
    banner: extensionString(decoded, "banner"),
    website: extensionString(decoded, "website"),
    uri: extensionString(decoded, "uri"),
    url: extensionString(decoded, "url"),
    twitter: extensionString(decoded, "twitter"),
    x: extensionString(decoded, "x"),
    github: extensionString(decoded, "github"),
    discord: extensionString(decoded, "discord"),
    telegram: extensionString(decoded, "telegram"),
    tokenAddress: extensionString(decoded, "tokenAddress"),
    staked: extensionString(decoded, "staked"),
    tee: extensionBoolean(decoded, "tee"),
    supportsERC8211: extensionBoolean(decoded, "supportsERC8211"),
    medusaPassportSupported: extensionBoolean(decoded, "medusaPassportSupported"),
    medusaPassportUseCase: extensionString(decoded, "medusaPassportUseCase"),
    medusaMinTier: extensionString(decoded, "medusaMinTier"),
    customTags: extensionStrings(decoded, "customTags") ?? extensionString(decoded, "customTags"),
    mcpTools: extensionStrings(decoded, "mcpTools"),
    a2aSkills: extensionStrings(decoded, "a2aSkills"),
    oasfSkills: extensionStrings(decoded, "oasfSkills"),
    oasfDomains: extensionStrings(decoded, "oasfDomains"),
    binanceSkills: extensionStrings(decoded, "binanceSkills"),
    extensions: decoded.extensions,
    rawDocumentDigest: decoded.rawDocumentDigest,
    normalizedFingerprint: decoded.normalizedFingerprint,
    decoderVersion: REGISTRATION_DECODER_VERSION,
  };
}
async function persistObservation(result: RegistrationDocumentResult): Promise<void> {
  await prisma.registrationDocumentObservation.createMany({
    data: [{
      sourceUri: result.transport.sourceUri,
      normalizedUri: result.transport.normalizedUri,
      sourceContentAddress: result.transport.sourceContentAddress,
      cidVersion: result.transport.cidVersion,
      cidCodec: result.transport.cidCodec == null ? null : String(result.transport.cidCodec),
      cidMultihashCode: result.transport.cidMultihashCode == null ? null : String(result.transport.cidMultihashCode),
      cidDigest: result.transport.cidDigest,
      ipfsPath: result.transport.ipfsPath,
      retrievalMethod: result.transport.retrievalMethod,
      availabilityStatus: "available",
      byteIntegrityStatus: "verified-by-transport",
      jsonValidityStatus: "valid",
      schemaValidityStatus: "valid",
      rawDocumentDigest: result.decoded.rawDocumentDigest,
      normalizedFingerprint: result.decoded.normalizedFingerprint,
      rawBytes: Uint8Array.from(result.decoded.rawBytes),
      parsedCore: prismaJson({
        type: result.decoded.type,
        name: result.decoded.name,
        description: result.decoded.description,
        image: result.decoded.image,
        services: result.decoded.services,
        registrations: result.decoded.registrations,
        declaredActive: result.decoded.declaredActive,
        declaredX402Support: result.decoded.declaredX402Support,
        supportedTrust: result.decoded.supportedTrust,
        truncations: result.decoded.truncations,
        hadBom: result.decoded.hadBom,
      }),
      extensions: prismaJson(result.decoded.extensions),
      decoderVersion: REGISTRATION_DECODER_VERSION,
      immutable: result.transport.immutable,
    }],
    skipDuplicates: true,
  });
}
async function loadRegistrationDocumentDetailed(
  uri: string,
  timeoutMs: number,
  expected?: { chainId: number; registryAddress: string; agentId: string | bigint },
  signal?: AbortSignal,
): Promise<RegistrationDocumentResult | null> {
  throwIfAborted(signal);
  const trimmed = uri.trim();
  if (!trimmed) return null;
  let bytes: Uint8Array;
  let transport: RegistrationTransportMetadata;
  if (trimmed.startsWith("data:")) {
    const parsed = parseRegistrationDataUri(trimmed);
    bytes = parsed.bytes;
    transport = {
      sourceUri: trimmed,
      normalizedUri: `data:sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      retrievalMethod: "data-uri",
      contentType: parsed.contentType,
      immutable: true,
      sourceContentAddress: null,
      cidVersion: null,
      cidCodec: null,
      cidMultihashCode: null,
      cidDigest: null,
      ipfsPath: null,
    };
  } else if (isIpfsReference(trimmed)) {
    const fetched: IpfsByteResponse = await fetchIpfsBytes(trimmed, signal);
    bytes = fetched.bytes;
    transport = {
      sourceUri: trimmed,
      normalizedUri: fetched.normalizedUri,
      retrievalMethod: fetched.retrievalMethod,
      contentType: fetched.retrievalMethod === "dag-get" ? "application/json" : null,
      immutable: true,
      sourceContentAddress: fetched.canonicalCid,
      cidVersion: fetched.cid.version,
      cidCodec: fetched.codec,
      cidMultihashCode: fetched.multihashCode,
      cidDigest: fetched.multihashDigestHex,
      ipfsPath: fetched.path || null,
    };
  } else {
    if (!trimmed.startsWith("https://")) return null;
    const fetched = await fetchPublicBytes(trimmed, timeoutMs, MAX_BYTES, signal);
    bytes = fetched.bytes;
    transport = {
      sourceUri: trimmed,
      normalizedUri: fetched.finalUrl,
      retrievalMethod: "https",
      contentType: fetched.contentType,
      immutable: false,
      sourceContentAddress: null,
      cidVersion: null,
      cidCodec: null,
      cidMultihashCode: null,
      cidDigest: null,
      ipfsPath: null,
    };
  }
  throwIfAborted(signal);
  if (bytes.byteLength > MAX_BYTES) throw new Error(`registration exceeds ${MAX_BYTES} bytes`);
  const decoded = decodeRegistrationDocument(bytes, expected);
  return { registration: toRegistrationJson(decoded), decoded, transport };
}
export async function fetchRegistrationDocumentDetailed(
  uri: string,
  timeoutMs: number,
  expected?: { chainId: number; registryAddress: string; agentId: string | bigint },
  signal?: AbortSignal,
): Promise<RegistrationDocumentResult | null> {
  throwIfAborted(signal);
  const trimmed = uri.trim();
  if (!trimmed) return null;
  const normalized = normalizeRegistrationUri(trimmed);
  const identity = `${normalized.key}\0${expectedCacheSuffix(expected)}\0${REGISTRATION_DECODER_VERSION}`;
  const digest = createHash("sha256").update(identity).digest("hex");
  const cacheKey = `indexer-registration-document:v2:${digest}`;
  const existing = registrationInFlight.get(cacheKey);
  if (existing) {
    const cached = await existing;
    if (cached.kind === "negative") throw new Error(cached.message);
    return defensiveCopy(deserializeRegistrationResult(cached.value));
  }

  const promise = getOrLoadValkeyJson<RegistrationCacheEntry>({
    key: cacheKey,
    leaseKey: `indexer-registration-document-lock:v2:${digest}`,
    ttlSeconds: registrationCacheTtlSeconds,
    validate: isRegistrationCacheEntry,
    maxPayloadBytes: Math.min(64 * 1024 * 1024, MAX_BYTES * 4 + 2 * 1024 * 1024),
    leaseTtlMs: Math.min(180_000, Math.max(30_000, timeoutMs + 15_000)),
    waitMs: Math.min(65_000, Math.max(5_000, timeoutMs + 5_000)),
    signal,
    load: async (loadSignal) => {
      let loaded: RegistrationDocumentResult | null;
      try {
        loaded = await loadRegistrationDocumentDetailed(trimmed, timeoutMs, expected, loadSignal);
      } catch (error) {
        if (loadSignal.aborted) throwIfAborted(loadSignal);
        const permanent = normalized.immutable && permanentRegistrationFailure(error);
        return {
          kind: "negative",
          message: redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 4_000),
          permanent,
          transport: normalized.transport,
        };
      }
      if (!loaded) {
        return {
          kind: "negative",
          message: "registration document was not available",
          permanent: false,
          transport: normalized.transport,
        };
      }
      // PostgreSQL observation persistence is mandatory and intentionally outside
      // the provider-error conversion above.
      await persistObservation(loaded);
      return {
        kind: "success",
        value: serializeRegistrationResult(loaded),
        transport: normalized.transport,
      };
    },
  });
  registrationInFlight.set(cacheKey, promise);
  const clearInflight = () => {
    if (registrationInFlight.get(cacheKey) === promise) registrationInFlight.delete(cacheKey);
  };
  void promise.then(clearInflight, clearInflight);

  const cached = await promise;
  if (cached.kind === "negative") throw new Error(cached.message);
  return defensiveCopy(deserializeRegistrationResult(cached.value));
}
export async function fetchRegistrationDocument(
  uri: string,
  timeoutMs: number,
  expected?: { chainId: number; registryAddress: string; agentId: string | bigint },
  signal?: AbortSignal,
): Promise<RegistrationJson | null> {
  try {
    return (await fetchRegistrationDocumentDetailed(uri, timeoutMs, expected, signal))?.registration ?? null;
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    return null;
  }
}
function transientRegistrationFailure(error: unknown): { errorClass: string; retryDelayMs: number } {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(?:ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED)\b|getaddrinfo/i.test(message)) {
    return { errorClass: "registration_dns_unavailable", retryDelayMs: 30 * 60_000 };
  }
  if (/cloudflare tunnel|error 1033|HTTP 52\d|HTTP 530/i.test(message)) {
    return { errorClass: "registration_origin_unavailable", retryDelayMs: 30 * 60_000 };
  }
  if (/HTTP 429|too many requests|rate limit/i.test(message)) {
    return { errorClass: "registration_rate_limited", retryDelayMs: 15 * 60_000 };
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return { errorClass: "registration_timeout", retryDelayMs: 10 * 60_000 };
  }
  if (/HTTP 5\d\d/i.test(message)) {
    return { errorClass: "registration_origin_unavailable", retryDelayMs: 15 * 60_000 };
  }
  return { errorClass: "registration_unavailable", retryDelayMs: 5 * 60_000 };
}
export type RegistrationFetchAttempt =
  | { status: "valid"; result: RegistrationDocumentResult }
  | { status: "not_declared"; result: null }
  | { status: "permanent_invalid"; result: null; errorClass: string; message: string; nextRetryAt: null }
  | { status: "transient_unavailable"; result: null; errorClass: string; message: string; nextRetryAt: Date };
export async function attemptRegistrationDocument(
  uri: string,
  timeoutMs: number,
  expected?: { chainId: number; registryAddress: string; agentId: string | bigint },
  signal?: AbortSignal,
): Promise<RegistrationFetchAttempt> {
  const trimmed = uri.trim();
  if (!trimmed) return { status: "not_declared", result: null };
  try {
    const result = await fetchRegistrationDocumentDetailed(trimmed, timeoutMs, expected, signal);
    if (!result) return { status: "not_declared", result: null };
    return { status: "valid", result };
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    const message = redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 2_000);
    if (permanentRegistrationFailure(error)) {
      return { status: "permanent_invalid", result: null, errorClass: "registration_invalid", message, nextRetryAt: null };
    }
    const transient = transientRegistrationFailure(error);
    return {
      status: "transient_unavailable",
      result: null,
      errorClass: transient.errorClass,
      message,
      nextRetryAt: new Date(Date.now() + transient.retryDelayMs),
    };
  }
}
