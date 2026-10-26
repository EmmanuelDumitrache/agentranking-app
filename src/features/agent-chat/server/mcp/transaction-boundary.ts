import "server-only";

import { createHash } from "node:crypto";
import { WAGMI_CHAIN_IDS } from "@/lib/wagmi-chain-ids";
import { canonicalMcpJson } from "./catalog-validation";
import type { McpToolRisk } from "./types";
import { recordMcpOperationalEvent, recordMcpTransactionIntent } from "./observability";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function findTransactionIntent(
  value: unknown,
  depth = 0,
  permitAmbiguousKeys = false,
): Record<string, unknown> | null {
  if (depth > 6) return null;
  if (Array.isArray(value)) {
    for (const nested of value) {
      const found = findTransactionIntent(nested, depth + 1, permitAmbiguousKeys);
      if (found) return found;
    }
    return null;
  }
  const record = object(value);
  if (!record) return null;
  for (const key of ["transactionRequest", "transaction_request", "unsignedTransaction", "unsigned_transaction"]) {
    const candidate = record[key];
    if (object(candidate)) return candidate as Record<string, unknown>;
    if (typeof candidate === "string" && candidate.length > 20) {
      return { encodedPayload: candidate };
    }
  }
  if (permitAmbiguousKeys) {
    for (const key of ["transaction", "tx", "calldata"]) {
      const candidate = record[key];
      if (object(candidate)) return candidate as Record<string, unknown>;
      if (typeof candidate === "string" && candidate.length > 20) {
        return { encodedPayload: candidate };
      }
    }
  }
  for (const nested of Object.values(record)) {
    const found = findTransactionIntent(nested, depth + 1, permitAmbiguousKeys);
    if (found) return found;
  }
  return null;
}

// `unsignedTransaction` is the expected safe handoff shape. Keep the matcher
// broad for nested/camel-case provider payloads while ensuring the `signed`
// branch cannot match the tail of `unsignedTransaction`.
const FORBIDDEN_TRANSACTION_KEY = /(?:private[_-]?key|mnemonic|seed(?:[_-]?(?:phrase|words))?|secret|(?<!un)signed[_-]?transaction|raw[_-]?(?:signed[_-]?)?(?:transaction|tx)|signature|wallet[_-]?export)/i;
const PRIVATE_MATERIAL_VALUE = /(?:BEGIN [A-Z ]*PRIVATE KEY|\b(?:mnemonic|seed phrase|private key)\b)/i;

function containsForbiddenTransactionMaterial(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (typeof value === "string") return PRIVATE_MATERIAL_VALUE.test(value);
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenTransactionMaterial(item, depth + 1));
  }
  const record = object(value);
  if (!record) return false;
  return Object.entries(record).some(([key, nested]) =>
    FORBIDDEN_TRANSACTION_KEY.test(key)
    || containsForbiddenTransactionMaterial(nested, depth + 1));
}

function findPrimitive(
  value: unknown,
  names: readonly string[],
  depth = 0,
): string | number | boolean | null {
  if (depth > 5) return null;
  if (Array.isArray(value)) {
    for (const nested of value) {
      const found = findPrimitive(nested, names, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const record = object(value);
  if (!record) return null;
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, candidate] of Object.entries(record)) {
    if (wanted.has(key.toLowerCase())
      && (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean")) {
      return typeof candidate === "string" ? candidate.slice(0, 512) : candidate;
    }
  }
  for (const nested of Object.values(record)) {
    const found = findPrimitive(nested, names, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function findStringPrimitive(value: unknown, names: readonly string[], depth = 0): string | null {
  if (depth > 5) return null;
  if (Array.isArray(value)) {
    for (const nested of value) {
      const found = findStringPrimitive(nested, names, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const record = object(value);
  if (!record) return null;
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, candidate] of Object.entries(record)) {
    if (wanted.has(key.toLowerCase()) && typeof candidate === "string") return candidate;
  }
  for (const nested of Object.values(record)) {
    const found = findStringPrimitive(nested, names, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function parsePositiveChainId(value: string | number | boolean | null): number | null {
  if (typeof value === "boolean" || value === null) return null;
  const parsed = typeof value === "number"
    ? value
    : /^0x[0-9a-f]+$/i.test(value)
      ? Number.parseInt(value.slice(2), 16)
      : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validEvmQuantity(value: string | number | boolean | null): boolean {
  if (value === null) return true;
  if (typeof value === "boolean") return false;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  if (/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) return true;
  return /^(?:0|[1-9][0-9]*)$/.test(value);
}

function decodeEvmCall(data: string | null) {
  const valid = data === null || /^0x(?:[0-9a-f]{2})*$/i.test(data);
  const selector = valid && data && data.length >= 10 ? data.slice(0, 10).toLowerCase() : null;
  let approval: { spender: string; amount: string; unlimited: boolean } | null = null;
  if (selector === "0x095ea7b3" && data && data.length >= 138) {
    const spenderWord = data.slice(10, 74);
    const amountWord = data.slice(74, 138);
    const amount = BigInt(`0x${amountWord}`);
    approval = {
      spender: `0x${spenderWord.slice(24)}`,
      amount: amount.toString(),
      unlimited: amount >= (1n << 255n),
    };
  }
  return { valid, selector, approval };
}

function transactionReviewSummary(result: unknown, intent: Record<string, unknown>) {
  const data = findStringPrimitive(intent, ["data", "calldata", "encodedPayload"]);
  const chain = findPrimitive(result, ["chain", "network", "chainId", "chain_id"]);
  const destination = findPrimitive(intent, ["to", "recipient", "contract", "destinationAddress"]);
  const value = findPrimitive(intent, ["value", "amount"]);
  const chainId = parsePositiveChainId(chain);
  const supportedChain = chainId !== null && WAGMI_CHAIN_IDS.has(chainId);
  const evmDestination = typeof destination === "string" && /^0x[0-9a-f]{40}$/i.test(destination);
  const evmCall = decodeEvmCall(data);
  const evmDecodable = supportedChain
    && evmDestination
    && evmCall.valid
    && validEvmQuantity(value)
    && (data !== null || value !== null);
  return {
    chain,
    chainId,
    supportedChain,
    decoder: evmDecodable ? "evm-transaction-request" : null,
    destination,
    asset: findPrimitive(result, ["asset", "token", "symbol", "mint"]),
    amount: findPrimitive(result, ["amount", "value"]),
    transactionValue: value,
    operation: findPrimitive(result, ["operation", "action", "method"]),
    slippage: findPrimitive(result, ["slippage", "slippageBps", "slippageTolerance"]),
    minimumOutput: findPrimitive(result, ["minimumOutput", "minAmountOut", "toAmountMin"]),
    destinationChain: findPrimitive(result, ["destinationChain", "toChain", "toChainId"]),
    destinationAddress: findPrimitive(result, ["destinationAddress", "toAddress"]),
    fee: findPrimitive(result, ["fee", "gas", "gasLimit", "gasPrice"]),
    deadline: findPrimitive(result, ["deadline", "expiry", "expiresAt"]),
    expectedSigner: findPrimitive(result, ["signer", "from", "walletAddress"]),
    additionalSignerRequired: findPrimitive(result, ["additionalSignerRequired", "requiresAdditionalSigner"]),
    calldataPresent: typeof data === "string" && data.length > 0,
    methodSelector: evmCall.selector,
    calldataHash: typeof data === "string"
      ? createHash("sha256").update(data).digest("hex")
      : null,
    tokenApproval: evmCall.approval,
    unlimitedApproval: evmCall.approval?.unlimited ?? false,
    decodable: evmDecodable,
  };
}

export function enforceNativeTransactionBoundary(params: {
  result: unknown;
  risk: McpToolRisk;
  providerKey: string | null;
  connectionId: string;
}): unknown {
  const declaredTransactionRisk = ["TRANSACTION_PREPARE", "TRADE"].includes(params.risk);
  const intent = findTransactionIntent(params.result, 0, declaredTransactionRisk);
  if (!declaredTransactionRisk && !intent) return params.result;
  const forbidden = containsForbiddenTransactionMaterial(
    declaredTransactionRisk ? params.result : intent,
  );
  const existingSource = object(object(params.result)?.source);
  const review = intent
    ? transactionReviewSummary(params.result, intent)
    : { decodable: false, unlimitedApproval: false, supportedChain: false };
  // The approval identity covers both the raw unsigned intent and every field
  // shown to the reviewer. A provider cannot retain an approval while changing
  // chain, recipient, amount, slippage, fee, expiry, or decoded calldata.
  const intentHash = createHash("sha256").update(canonicalMcpJson({
    providerKey: params.providerKey,
    connectionId: params.connectionId,
    intent: intent ?? { blockedProviderOutput: true, output: params.result },
    review,
  })).digest("hex");
  const source = {
    ...existingSource,
    kind: "mcp",
    connectionId: params.connectionId,
    providerKey: params.providerKey,
    risk: declaredTransactionRisk ? params.risk : "TRANSACTION_PREPARE",
  };
  if (forbidden || !review.decodable || review.unlimitedApproval) {
    recordMcpOperationalEvent({
      event: "policy",
      outcome: "transaction_blocked",
      providerKey: params.providerKey,
      risk: declaredTransactionRisk ? params.risk : "TRANSACTION_PREPARE",
      reason: forbidden
        ? "forbidden_material"
        : review.unlimitedApproval
          ? "unlimited_approval"
          : !review.supportedChain
            ? "unsupported_chain"
            : "not_decodable",
    });
    return {
      ok: false,
      status: "unsigned_transaction_blocked",
      untrustedExternalData: true,
      source,
      transactionIntentHash: intentHash,
      transactionReviewSummary: review,
      nativeBoundary: {
        signed: false,
        broadcast: false,
        eligibleForNativeReview: false,
        simulationRequired: true,
        explicitApprovalRequired: true,
        reason: forbidden
          ? "The provider payload contained signed or secret-bearing transaction material."
          : review.unlimitedApproval
            ? "The transaction requested an unlimited token allowance, which is blocked by default."
            : !review.supportedChain
              ? "The transaction chain is missing or unsupported by AgentRanking's native wallet configuration."
              : "The unsigned payload could not be decoded into a chain, destination, and action/value.",
        message: "This MCP payload was not forwarded to native wallet controls.",
      },
    };
  }
  recordMcpTransactionIntent(params.providerKey);
  return {
    ok: true,
    status: "unsigned_transaction_requires_native_review",
    untrustedExternalData: true,
    source,
    transactionIntent: intent,
    transactionIntentHash: intentHash,
    transactionReviewSummary: review,
    nativeBoundary: {
      signed: false,
      broadcast: false,
      eligibleForNativeReview: true,
      simulationRequired: true,
      explicitApprovalRequired: true,
      message:
        "This MCP output is an untrusted unsigned transaction proposal. It must be decoded, simulated, approved, signed, and broadcast by native wallet controls.",
    },
  };
}
