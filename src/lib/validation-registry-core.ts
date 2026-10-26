import { parseAbiItem } from "viem";
import type { ValidationMethod } from "@/types/agent";
export const VALIDATION_PASS_SCORE = 100;
export const VALIDATION_RESPONSE_EVENT = parseAbiItem(
  "event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
);
export const VALIDATION_REQUEST_EVENT = parseAbiItem(
  "event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)",
);
export type ValidationLogArgs = {
  agentId: bigint | number | null | undefined;
  response: number | null | undefined;
  validatorAddress?: string | null;
  tag?: string | null;
};
export function isChainVerificationPass(response: number): boolean {
  return response >= VALIDATION_PASS_SCORE;
}
/** Map ERC-8004 validation tag bytes / labels to platform method enum. */
export function parseValidationMethodFromTag(tag: string): ValidationMethod {
  const raw = tag.trim();
  const lower = raw.toLowerCase();
  if (lower === "0x01" || lower === "01" || lower.includes("crypto-economic") || lower.includes("stake")) {
    return "crypto_economic";
  }
  if (lower === "0x02" || lower === "02" || lower.includes("zkml") || lower.includes("zk-ml") || lower.includes("zkml-proof")) {
    return "zkml";
  }
  if (lower === "0x03" || lower === "03" || lower.includes("tee")) {
    return "tee";
  }
  if (/^0x[0-9a-f]{2}$/i.test(raw)) {
    const byte = Number.parseInt(raw.slice(2), 16);
    if (byte === 1) return "crypto_economic";
    if (byte === 2) return "zkml";
    if (byte === 3) return "tee";
  }
  return "unknown";
}
export function validationVerificationFromLog(
  chainId: number,
  args: ValidationLogArgs,
  txHash = "",
): {
  chainId: number;
  agentId: number;
  verified: boolean;
  score: number;
  validator: string;
  tag: string;
  txHash: string;
} | null {
  const agentId = Number(args.agentId);
  const response = Number(args.response ?? 0);
  if (!Number.isFinite(agentId) || agentId <= 0) return null;
  return {
    chainId,
    agentId,
    verified: isChainVerificationPass(response),
    score: response,
    validator: String(args.validatorAddress ?? ""),
    tag: String(args.tag ?? ""),
    txHash,
  };
}