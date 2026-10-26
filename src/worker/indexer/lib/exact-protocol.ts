import { getAddress, isAddress, keccak256, toBytes } from "viem";
export const UINT256_MAX = (1n << 256n) - 1n;
export const UINT64_MAX = (1n << 64n) - 1n;
export const INT128_MIN = -(1n << 127n);
export const INT128_MAX = (1n << 127n) - 1n;
export const ERC8004_FEEDBACK_MAX_ABS = 10n ** 38n;
export type RpcData = `0x${string}`;
export function parseCanonicalUnsignedDecimal(
  value: string,
  options: { max?: bigint; allowZero?: boolean; label?: string } = {},
): bigint {
  const label = options.label ?? "unsigned integer";
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical unsigned decimal integer`);
  }
  const parsed = BigInt(value);
  if (options.allowZero === false && parsed === 0n) throw new Error(`${label} must be greater than zero`);
  if (options.max != null && parsed > options.max) throw new Error(`${label} exceeds its protocol range`);
  return parsed;
}
export function canonicalUint256(value: string | bigint, allowZero = true): string {
  const parsed = typeof value === "bigint"
    ? value
    : parseCanonicalUnsignedDecimal(value, { max: UINT256_MAX, allowZero, label: "agent id" });
  if (parsed < 0n || parsed > UINT256_MAX || (!allowZero && parsed === 0n)) {
    throw new Error("agent id is outside uint256 range");
  }
  return parsed.toString(10);
}
export function compatibleAgentInt(value: string): number | null {
  const parsed = parseCanonicalUnsignedDecimal(value, { max: UINT256_MAX, label: "agent id" });
  if (parsed > BigInt(2_147_483_647)) return null;
  return Number(parsed);
}
/** Strict Ethereum JSON-RPC QUANTITY decoder. */
export function parseRpcQuantity(value: unknown, label = "RPC quantity"): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`${label} is not a canonical Ethereum QUANTITY`);
  }
  return BigInt(value);
}
/** Strict Ethereum JSON-RPC DATA decoder. */
export function parseRpcData(value: unknown, bytes?: number, label = "RPC data"): RpcData {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${label} is not canonical even-length Ethereum DATA`);
  }
  if (bytes != null && value.length !== 2 + bytes * 2) {
    throw new Error(`${label} must contain exactly ${bytes} bytes`);
  }
  return value.toLowerCase() as RpcData;
}
export const parseData20 = (value: unknown, label = "address") => parseRpcData(value, 20, label);
export const parseData32 = (value: unknown, label = "hash") => parseRpcData(value, 32, label);
export function canonicalEvmAddress(value: string, label = "EVM address"): string {
  if (!isAddress(value, { strict: true })) throw new Error(`${label} must be a 20-byte EVM address`);
  return getAddress(value);
}
export function evmAddressBytesKey(value: string): string {
  return canonicalEvmAddress(value).toLowerCase();
}
export function exactFixedPoint(rawValue: bigint | string, decimals: number): string {
  const raw = typeof rawValue === "bigint" ? rawValue : BigInt(rawValue);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("value decimals are outside uint8 range");
  }
  const negative = raw < 0n;
  const magnitude = negative ? -raw : raw;
  if (decimals === 0) return `${negative ? "-" : ""}${magnitude}`;
  const digits = magnitude.toString(10).padStart(decimals + 1, "0");
  const integer = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals);
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}
export function validateErc8004FeedbackValue(rawValue: bigint, decimals: number): void {
  if (rawValue < INT128_MIN || rawValue > INT128_MAX) throw new Error("feedback value is outside int128 range");
  if (rawValue < -ERC8004_FEEDBACK_MAX_ABS || rawValue > ERC8004_FEEDBACK_MAX_ABS) {
    throw new Error("feedback value exceeds ERC-8004 v2.0.0 business bounds");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("feedback valueDecimals must be in 0..18");
  }
}
export function metadataKeyTopic(metadataKey: string): string {
  return keccak256(toBytes(metadataKey));
}
export function decodePackedAgentWallet(raw: Uint8Array): {
  state: "unset" | "set" | "malformed";
  address: string | null;
} {
  if (raw.byteLength === 0) return { state: "unset", address: null };
  if (raw.byteLength !== 20) return { state: "malformed", address: null };
  const hex = `0x${Buffer.from(raw).toString("hex")}`;
  const address = canonicalEvmAddress(hex, "packed agentWallet");
  if (address === "0x0000000000000000000000000000000000000000") return { state: "unset", address: null };
  return { state: "set", address };
}
export type EvmEventPosition = {
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
};
export function compareEvmEventPosition(a: EvmEventPosition, b: EvmEventPosition): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  if (a.transactionIndex !== b.transactionIndex) return a.transactionIndex - b.transactionIndex;
  return a.logIndex - b.logIndex;
}
export function evmEventKey(input: {
  chainId: number;
  contractAddress: string;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
}): string {
  return [
    input.chainId,
    evmAddressBytesKey(input.contractAddress),
    parseData32(input.blockHash, "block hash"),
    parseData32(input.transactionHash, "transaction hash"),
    input.logIndex,
  ].join(":");
}
export function bigintJson(value: bigint | null | undefined): string | null {
  return value == null ? null : value.toString(10);
}
