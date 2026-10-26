import { createHash } from "node:crypto";
import { canonicalEvmAddress } from "./exact-protocol.js";
import { decodeJsonBytes, losslessToJsonSafe } from "./lossless-json.js";
import { boundUtf8String } from "./unicode-bounds.js";

export const ONCHAIN_VALUE_DECODER_VERSION = "agent-onchain-value/3";

export type DecodedOnchainValue = {
  decodedType: string;
  semanticType: string;
  text: string | null;
  address: string | null;
  boolean: boolean | null;
  integer: string | null;
  uri: string | null;
  bytes32: string | null;
  json: unknown | null;
  evidence: Record<string, unknown>;
};

const URI_SCHEMES = /^(?:https?:|ipfs:|ipns:|ar:|data:|did:|mailto:|eip155:|solana:)/i;
const INTEGER_HINT = /(?:count|nonce|index|id|timestamp|time|block|slot|rank|score|amount|value|decimals|supply|chain|epoch|sequence|versionnumber|limit|capacity)/i;
const SIGNED_INTEGER_HINT = /(?:delta|change|offset|signed|adjustment)/i;
const BOOLEAN_HINT = /(?:active|enabled|verified|support|flag|paused|revoked|bound|valid|public|private|archived|deprecated)/i;
const ADDRESS_HINT = /(?:address|wallet|owner|operator|recipient|sender|client|validator|registry|contract|authority|delegate|beneficiary|treasury)/i;
const URI_HINT = /(?:uri|url|endpoint|image|icon|avatar|logo|website|homepage|metadata|document|schema|manifest)/i;
const TEXT_HINT = /(?:name|title|description|symbol|label|version|type|category|status|tag|domain|skill|capability|network|namespace)/i;

function hex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

function unsignedBigEndian(bytes: Uint8Array): string {
  if (bytes.length === 0) return "0";
  return BigInt(hex(bytes)).toString(10);
}

function signedBigEndian(bytes: Uint8Array): string {
  if (bytes.length === 0) return "0";
  const unsigned = BigInt(hex(bytes));
  const bits = BigInt(bytes.length * 8);
  const signBit = 1n << (bits - 1n);
  return (unsigned & signBit) === 0n ? unsigned.toString(10) : (unsigned - (1n << bits)).toString(10);
}

function textProjection(bytes: Uint8Array): string | null {
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if ([...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (codePoint < 0x20 && character !== "\t" && character !== "\n" && character !== "\r") ||
        (codePoint >= 0x7f && codePoint <= 0x9f);
    })) return null;
    return boundUtf8String(value, 16_384, "metadata text projection").value;
  } catch {
    return null;
  }
}

function paddedTextProjection(bytes: Uint8Array): string | null {
  const zero = bytes.indexOf(0);
  if (zero <= 0) return null;
  for (let index = zero; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) return null;
  }
  const prefix = bytes.slice(0, zero);
  const text = textProjection(prefix);
  if (text == null || !/[\p{L}\p{N}]/u.test(text)) return null;
  if ([...text].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 && character !== "\t" && character !== "\n" && character !== "\r";
  })) return null;
  return text;
}

function normalizeUri(value: string): string | null {
  const trimmed = value.trim();
  if (!URI_SCHEMES.test(trimmed)) return null;
  if (/^https?:/i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      url.hostname = url.hostname.toLowerCase();
      return url.toString();
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function semanticTypeForKey(key: string, fallback: string): string {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (normalized === "agentwallet") return "agent-wallet";
  if (normalized.includes("registry")) return fallback === "address" ? "registry-address" : "registry-reference";
  if (normalized.includes("validator")) return fallback === "address" ? "validator-address" : "validator-reference";
  if (normalized.includes("owner")) return fallback === "address" ? "owner-address" : fallback;
  if (normalized.includes("wallet")) return fallback === "address" ? "wallet-address" : fallback;
  if (normalized.includes("endpoint")) return fallback === "uri" ? "service-endpoint" : fallback;
  if (normalized.includes("image") || normalized.includes("icon") || normalized.includes("avatar") || normalized.includes("logo")) return fallback === "uri" ? "image-uri" : fallback;
  if (normalized.includes("schema")) return fallback === "uri" ? "schema-uri" : fallback;
  if (normalized.includes("chain") && fallback === "integer") return "chain-id";
  if (normalized.includes("timestamp") || normalized.endsWith("time")) return fallback === "integer" ? "timestamp" : fallback;
  return fallback;
}

function baseResult(evidence: Record<string, unknown>, overrides: Partial<DecodedOnchainValue>): DecodedOnchainValue {
  return {
    decodedType: "binary",
    semanticType: "opaque-bytes",
    text: null,
    address: null,
    boolean: null,
    integer: null,
    uri: null,
    bytes32: null,
    json: null,
    evidence,
    ...overrides,
  };
}

function decodeAbiDynamic(bytes: Uint8Array): { payload: Uint8Array; offset: number; declaredLength: number } | null {
  if (bytes.length < 64 || bytes.length % 32 !== 0) return null;
  const offset = Number(BigInt(hex(bytes.slice(0, 32))));
  if (!Number.isSafeInteger(offset) || offset < 32 || offset % 32 !== 0 || offset + 32 > bytes.length) return null;
  const declaredLength = Number(BigInt(hex(bytes.slice(offset, offset + 32))));
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || offset + 32 + declaredLength > bytes.length) return null;
  const paddedEnd = offset + 32 + Math.ceil(declaredLength / 32) * 32;
  if (paddedEnd > bytes.length) return null;
  for (let index = offset + 32 + declaredLength; index < paddedEnd; index += 1) {
    if (bytes[index] !== 0) return null;
  }
  return { payload: bytes.slice(offset + 32, offset + 32 + declaredLength), offset, declaredLength };
}

function decodeTextual(key: string, bytes: Uint8Array, text: string, evidence: Record<string, unknown>, decodedTypePrefix = "utf8"): DecodedOnchainValue {
  const trimmed = text.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    const address = canonicalEvmAddress(trimmed);
    return baseResult(evidence, { decodedType: `${decodedTypePrefix}-address`, semanticType: semanticTypeForKey(key, "address"), text, address });
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return baseResult(evidence, { decodedType: `${decodedTypePrefix}-bytes32`, semanticType: semanticTypeForKey(key, "hash"), text, bytes32: trimmed.toLowerCase() });
  }
  const uri = normalizeUri(trimmed);
  if (uri) return baseResult(evidence, { decodedType: `${decodedTypePrefix}-uri`, semanticType: semanticTypeForKey(key, "uri"), text, uri });
  if (/^(?:true|false)$/i.test(trimmed) || (BOOLEAN_HINT.test(key) && /^(?:0|1)$/i.test(trimmed))) {
    return baseResult(evidence, { decodedType: `${decodedTypePrefix}-boolean`, semanticType: semanticTypeForKey(key, "boolean"), text, boolean: /^(?:true|1)$/i.test(trimmed) });
  }
  if (/^-?(?:0|[1-9][0-9]*)$/.test(trimmed) && INTEGER_HINT.test(key)) {
    return baseResult(evidence, { decodedType: `${decodedTypePrefix}-integer`, semanticType: semanticTypeForKey(key, "integer"), text, integer: BigInt(trimmed).toString(10) });
  }
  if (/^[\[{]/.test(trimmed)) {
    try {
      const parsed = losslessToJsonSafe(decodeJsonBytes(bytes).value);
      return baseResult(evidence, { decodedType: "json", semanticType: "structured-json", text, json: parsed });
    } catch (error) {
      evidence.jsonError = error instanceof Error ? error.message : String(error);
    }
  }
  return baseResult(evidence, { decodedType: decodedTypePrefix, semanticType: semanticTypeForKey(key, URI_HINT.test(key) ? "uri-text" : TEXT_HINT.test(key) ? "text" : "text"), text });
}

export function decodeOnchainMetadataValue(metadataKey: string, bytes: Uint8Array): DecodedOnchainValue {
  const key = metadataKey.trim();
  const evidence: Record<string, unknown> = {
    decoderVersion: ONCHAIN_VALUE_DECODER_VERSION,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    keyHints: {
      address: ADDRESS_HINT.test(key),
      boolean: BOOLEAN_HINT.test(key),
      integer: INTEGER_HINT.test(key),
      uri: URI_HINT.test(key),
      text: TEXT_HINT.test(key),
    },
  };
  if (bytes.length === 0) {
    return baseResult(evidence, { decodedType: "empty", semanticType: "unset", text: "" });
  }
  if (key === "agentWallet") {
    if (bytes.length !== 20) throw new Error("agentWallet metadata must be empty or exactly 20 bytes");
    const address = canonicalEvmAddress(hex(bytes));
    return baseResult(evidence, { decodedType: "packed-address", semanticType: "agent-wallet", address });
  }

  const abiDynamic = decodeAbiDynamic(bytes);
  if (abiDynamic) {
    evidence.abiLayout = { kind: "dynamic", offset: abiDynamic.offset, declaredLength: abiDynamic.declaredLength };
    const dynamicText = textProjection(abiDynamic.payload);
    if (dynamicText != null) return decodeTextual(key, abiDynamic.payload, dynamicText, evidence, "abi-dynamic-utf8");
    return baseResult(evidence, { decodedType: "abi-dynamic-bytes", semanticType: "opaque-bytes" });
  }

  if (bytes.length === 20 && ADDRESS_HINT.test(key)) {
    const address = canonicalEvmAddress(hex(bytes));
    evidence.interpretationConfidence = "high";
    return baseResult(evidence, { decodedType: "packed-address", semanticType: semanticTypeForKey(key, "address"), address });
  }

  const text = textProjection(bytes);
  if (text != null) return decodeTextual(key, bytes, text, evidence);

  if (bytes.length === 20) {
    const address = canonicalEvmAddress(hex(bytes));
    evidence.interpretationConfidence = "medium";
    return baseResult(evidence, { decodedType: "packed-address", semanticType: semanticTypeForKey(key, "address"), address });
  }

  if (bytes.length === 32) {
    const bytes32 = hex(bytes).toLowerCase();
    const firstTwelveZero = bytes.slice(0, 12).every((value) => value === 0);
    if (firstTwelveZero && ADDRESS_HINT.test(key) && bytes.slice(12).some((value) => value !== 0)) {
      const address = canonicalEvmAddress(hex(bytes.slice(12)));
      evidence.abiLayout = { kind: "word-address", leftPaddingBytes: 12 };
      return baseResult(evidence, { decodedType: "abi-address", semanticType: semanticTypeForKey(key, "address"), address, bytes32 });
    }
    const firstThirtyOneZero = bytes.slice(0, 31).every((value) => value === 0);
    if (firstThirtyOneZero && BOOLEAN_HINT.test(key) && (bytes[31] === 0 || bytes[31] === 1)) {
      evidence.abiLayout = { kind: "word-bool" };
      return baseResult(evidence, { decodedType: "abi-boolean", semanticType: semanticTypeForKey(key, "boolean"), boolean: bytes[31] === 1, bytes32 });
    }
    const paddedText = paddedTextProjection(bytes);
    if (paddedText != null && (TEXT_HINT.test(key) || URI_HINT.test(key))) {
      evidence.abiLayout = { kind: "bytes32-text", rightPadded: true };
      const decoded = decodeTextual(key, new TextEncoder().encode(paddedText), paddedText, evidence, "bytes32-utf8");
      decoded.bytes32 = bytes32;
      return decoded;
    }
    if (INTEGER_HINT.test(key)) {
      const signed = SIGNED_INTEGER_HINT.test(key);
      evidence.abiLayout = { kind: signed ? "int256" : "uint256" };
      return baseResult(evidence, {
        decodedType: signed ? "int256" : "uint256",
        semanticType: semanticTypeForKey(key, "integer"),
        integer: signed ? signedBigEndian(bytes) : unsignedBigEndian(bytes),
        bytes32,
      });
    }
    return baseResult(evidence, { decodedType: "bytes32", semanticType: semanticTypeForKey(key, "hash-or-bytes32"), bytes32 });
  }

  if (bytes.length === 1 && BOOLEAN_HINT.test(key) && (bytes[0] === 0 || bytes[0] === 1)) {
    return baseResult(evidence, { decodedType: "packed-boolean", semanticType: semanticTypeForKey(key, "boolean"), boolean: bytes[0] === 1 });
  }

  if (INTEGER_HINT.test(key) && bytes.length <= 32) {
    const signed = SIGNED_INTEGER_HINT.test(key);
    evidence.interpretationConfidence = "key-hinted";
    return baseResult(evidence, {
      decodedType: signed ? `packed-int${bytes.length * 8}` : `packed-uint${bytes.length * 8}`,
      semanticType: semanticTypeForKey(key, "integer"),
      integer: signed ? signedBigEndian(bytes) : unsignedBigEndian(bytes),
    });
  }

  return baseResult(evidence, { decodedType: "binary", semanticType: "opaque-bytes" });
}
