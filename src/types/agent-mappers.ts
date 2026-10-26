import {
  isChainVerificationPass,
  parseValidationMethodFromTag,
  VALIDATION_PASS_SCORE,
  type ValidationLogArgs,
} from "@/lib/validation-registry-core";
import type { ValidationAttemptStatus, ValidationRecord } from "@/types/agent";
export { parseValidationMethodFromTag };
export type ValidationRequestLogArgs = {
  validatorAddress?: string | null;
  agentId?: bigint | number | null;
  requestHash?: `0x${string}` | string | null;
  requestURI?: string | null;
  tag?: string | null;
};
export type ValidationResponseLogMeta = {
  blockNumber?: bigint | null;
  logIndex?: bigint | null;
  transactionHash?: string | null;
};
function validationStatusFromScore(score: number | null | undefined): ValidationAttemptStatus {
  if (score == null || !Number.isFinite(score)) return "responded";
  return isChainVerificationPass(score) ? "passed" : "failed";
}
export function toValidationRecordFromRequestLog(
  chainId: number,
  args: ValidationRequestLogArgs,
  meta: ValidationResponseLogMeta = {},
): ValidationRecord | null {
  const agentId = Number(args.agentId);
  if (!Number.isFinite(agentId) || agentId <= 0) return null;
  const requestHash = String(args.requestHash ?? "");
  if (!requestHash) return null;
  const tag = String(args.tag ?? "");
  return {
    chainId,
    agentId,
    method: parseValidationMethodFromTag(tag),
    validatorAddress: String(args.validatorAddress ?? ""),
    requestHash,
    responseHash: "",
    responseURI: "",
    requestURI: String(args.requestURI ?? ""),
    score: null,
    status: "requested",
    blockNumber: meta.blockNumber != null ? Number(meta.blockNumber) : null,
    logIndex: meta.logIndex != null ? Number(meta.logIndex) : null,
    txHash: meta.transactionHash ?? "",
    attestedAt: null,
    tag,
  };
}
export function toValidationRecordFromResponseLog(
  chainId: number,
  args: ValidationLogArgs,
  meta: ValidationResponseLogMeta & { requestHash?: string | null; responseURI?: string | null; responseHash?: string | null } = {},
): ValidationRecord | null {
  const agentId = Number(args.agentId);
  const response = Number(args.response ?? 0);
  if (!Number.isFinite(agentId) || agentId <= 0) return null;
  const tag = String(args.tag ?? "");
  const requestHash = String(meta.requestHash ?? "");
  return {
    chainId,
    agentId,
    method: parseValidationMethodFromTag(tag),
    validatorAddress: String(args.validatorAddress ?? ""),
    requestHash,
    responseHash: String(meta.responseHash ?? ""),
    responseURI: String(meta.responseURI ?? ""),
    requestURI: "",
    score: Number.isFinite(response) ? response : null,
    status: validationStatusFromScore(response),
    blockNumber: meta.blockNumber != null ? Number(meta.blockNumber) : null,
    logIndex: meta.logIndex != null ? Number(meta.logIndex) : null,
    txHash: meta.transactionHash ?? "",
    attestedAt: meta.blockNumber != null ? new Date() : null,
    tag,
  };
}
/** Merge request + response rows by requestHash; response wins on conflicts. */
export function mergeValidationRecords(
  requests: readonly ValidationRecord[],
  responses: readonly ValidationRecord[],
): ValidationRecord[] {
  const byHash = new Map<string, ValidationRecord>();
  for (const row of requests) {
    if (!row.requestHash) continue;
    byHash.set(row.requestHash.toLowerCase(), row);
  }
  for (const row of responses) {
    if (!row.requestHash) {
      byHash.set(`response:${row.txHash}:${row.logIndex ?? 0}`, row);
      continue;
    }
    const key = row.requestHash.toLowerCase();
    const existing = byHash.get(key);
    if (!existing) {
      byHash.set(key, row);
      continue;
    }
    byHash.set(key, {
      ...existing,
      ...row,
      requestURI: existing.requestURI || row.requestURI,
      method: row.method !== "unknown" ? row.method : existing.method,
      status: row.status === "requested" ? existing.status : row.status,
      score: row.score ?? existing.score,
      attestedAt: row.attestedAt ?? existing.attestedAt,
    });
  }
  return [...byHash.values()].sort((a, b) => {
    const blockDiff = (b.blockNumber ?? 0) - (a.blockNumber ?? 0);
    if (blockDiff !== 0) return blockDiff;
    return (b.logIndex ?? 0) - (a.logIndex ?? 0);
  });
}
export { VALIDATION_PASS_SCORE, isChainVerificationPass };