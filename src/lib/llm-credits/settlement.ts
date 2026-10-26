import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { grantLlmBalanceInTx, makeLlmCryptoDepositIdempotencyKey } from "./credits";
import { LLM_CREDIT_REASONS } from "@/features/agent-chat/shared/constants";
import { getDepositConfig } from "./config";
import { referencePublicKeyFromString } from "./references";
import { findReferenceForDeposit } from "./solana-settlement";
import { validateDepositTransaction } from "./solana-parse";
import { computeMaxAmountAtomic, atomicAmountToUsdCents } from "./pricing";
import type { SettlementResult } from "./types";

export const settlementDeps = {
  prisma,
  grantLlmBalanceInTx,
  LLM_CREDIT_REASONS,
  getDepositConfig,
  referencePublicKeyFromString,
  findReferenceForDeposit,
  validateDepositTransaction,
  computeMaxAmountAtomic,
  atomicAmountToUsdCents,
};

const SETTLED_STATUSES = new Set(["SETTLED", "OVERPAID"]);
const TERMINAL_STATUSES = new Set(["UNDERPAID", "EXPIRED", "FAILED", "CANCELLED"]);
const SETTLEABLE_STATUSES = new Set(["CREATED", "AWAITING_PAYMENT", "CONFIRMING"]);

type CachedDeposit = {
  id: string;
  signature: string | null;
  creditedCents: number | null;
  creditLedgerId: string | null;
};

type SettlementOptions = {
  providedSignature?: string;
  providedSlot?: bigint;
};

function cachedSettlement(deposit: CachedDeposit): SettlementResult {
  if (!deposit.signature || deposit.creditedCents == null || !deposit.creditLedgerId) {
    throw new Error(`Settled deposit ${deposit.id} is missing settlement fields`);
  }
  return {
    ok: true,
    signature: deposit.signature,
    creditedCents: deposit.creditedCents,
    ledgerId: deposit.creditLedgerId,
  };
}

function depositRpcUrl(network: string): string {
  const explicit =
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_FALLBACK_URL?.trim();
  if (explicit) return explicit;
  return network === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
}

async function lockedPreflight(
  depositId: string,
  deps: typeof settlementDeps,
): Promise<SettlementResult | null> {
  return deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM llm_credit_deposits WHERE "id" = ${depositId} FOR UPDATE`;
    const fresh = await tx.llmCreditDeposit.findUnique({ where: { id: depositId } });
    if (!fresh) return { ok: false, reason: "deposit_not_found" };
    if (SETTLED_STATUSES.has(fresh.status)) return cachedSettlement(fresh);
    if (TERMINAL_STATUSES.has(fresh.status)) {
      return { ok: false, reason: "deposit_terminal_status" };
    }
    if (!SETTLEABLE_STATUSES.has(fresh.status)) {
      return { ok: false, reason: "deposit_not_settleable" };
    }
    if (fresh.quoteExpiresAt < new Date()) {
      await tx.llmCreditDeposit.update({
        where: { id: depositId },
        data: { status: "EXPIRED", failureReason: "quote_expired" },
      });
      return { ok: false, reason: "deposit_expired" };
    }
    return null;
  });
}

async function markUnderpaid(
  depositId: string,
  deps: typeof settlementDeps,
): Promise<SettlementResult> {
  return deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM llm_credit_deposits WHERE "id" = ${depositId} FOR UPDATE`;
    const fresh = await tx.llmCreditDeposit.findUnique({ where: { id: depositId } });
    if (!fresh) return { ok: false, reason: "deposit_not_found" };
    if (SETTLED_STATUSES.has(fresh.status)) return cachedSettlement(fresh);
    if (!SETTLEABLE_STATUSES.has(fresh.status)) {
      return { ok: false, reason: "deposit_terminal_status" };
    }
    await tx.llmCreditDeposit.update({
      where: { id: depositId },
      data: {
        status: "UNDERPAID",
        failureReason: "insufficient_amount",
        lastSyncAttemptAt: new Date(),
        syncAttemptCount: { increment: 1 },
      },
    });
    return { ok: false, reason: "underpaid" };
  });
}

/**
 * Settle a crypto deposit without holding a database transaction across RPC.
 * Every state transition is revalidated under a row lock, while the ledger
 * mutation and final deposit update commit atomically.
 */
export async function settleDeposit(
  depositId: string,
  deps = settlementDeps,
  options?: SettlementOptions,
): Promise<SettlementResult> {
  const deposit = await deps.prisma.llmCreditDeposit.findUnique({
    where: { id: depositId },
    include: { appAccount: true },
  });
  if (!deposit) return { ok: false, reason: "deposit_not_found" };
  if (SETTLED_STATUSES.has(deposit.status)) return cachedSettlement(deposit);
  if (TERMINAL_STATUSES.has(deposit.status)) {
    return { ok: false, reason: "deposit_terminal_status" };
  }

  const preflight = await lockedPreflight(depositId, deps);
  if (preflight) return preflight;

  const config = deps.getDepositConfig();
  const rpcUrl = depositRpcUrl(deposit.network);
  let referencePublicKey: PublicKey;
  try {
    referencePublicKey = deps.referencePublicKeyFromString(deposit.referencePublicKey);
  } catch (error) {
    console.error("[settlement] invalid reference public key:", error);
    return { ok: false, reason: "invalid_reference" };
  }

  let signature = options?.providedSignature?.trim() || null;
  if (!signature) {
    try {
      signature = await deps.findReferenceForDeposit(
        rpcUrl,
        deposit.referencePublicKey,
        config.settlementCommitment,
      );
    } catch (error) {
      console.error("[settlement] RPC error getting signatures:", error);
      return { ok: false, reason: "rpc_error" };
    }
    if (!signature) return { ok: false, reason: "no_transaction_found" };
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
    return { ok: false, reason: "invalid_signature" };
  }

  const toleranceBps = deposit.asset === "SOL"
    ? config.solOverpayToleranceBps
    : config.usdcOverpayToleranceBps;
  const validation = await deps.validateDepositTransaction(signature, rpcUrl, {
    recipient: deposit.recipientPublicKey,
    reference: referencePublicKey,
    expectedAtomic: deposit.expectedAmountAtomic,
    asset: deposit.asset,
    mint: deposit.mint ?? undefined,
    toleranceBps,
    commitment: config.settlementCommitment,
  });
  if (!validation.ok) {
    if (validation.reason === "insufficient_amount") {
      return markUnderpaid(depositId, deps);
    }
    return { ok: false, reason: validation.reason };
  }
  const actualAtomic = validation.actualAtomic;

  return deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM llm_credit_deposits WHERE "id" = ${depositId} FOR UPDATE`;
    const fresh = await tx.llmCreditDeposit.findUnique({ where: { id: depositId } });
    if (!fresh) return { ok: false, reason: "deposit_not_found" };
    if (SETTLED_STATUSES.has(fresh.status)) return cachedSettlement(fresh);
    if (!SETTLEABLE_STATUSES.has(fresh.status)) {
      return { ok: false, reason: "deposit_terminal_status" };
    }
    if (fresh.quoteExpiresAt < new Date()) {
      await tx.llmCreditDeposit.update({
        where: { id: depositId },
        data: { status: "EXPIRED", failureReason: "quote_expired" },
      });
      return { ok: false, reason: "deposit_expired" };
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`llm-credit-deposit-signature:${signature}`}, 0))`;
    const existingWithSignature = await tx.llmCreditDeposit.findUnique({
      where: { signature },
      select: { id: true },
    });
    if (existingWithSignature && existingWithSignature.id !== depositId) {
      return { ok: false, reason: "signature_already_used" };
    }

    const rawCents = actualAtomic > fresh.expectedAmountAtomic
      ? deps.atomicAmountToUsdCents(
          actualAtomic,
          fresh.asset,
          fresh.solUsdPriceMicros ?? undefined,
        )
      : fresh.quotedCents;
    const centsToGrant = Number(rawCents);
    if (!Number.isSafeInteger(centsToGrant) || centsToGrant <= 0) {
      throw new Error("Calculated credit amount is outside the supported range");
    }

    const grantResult = await deps.grantLlmBalanceInTx(tx, {
      appAccountId: fresh.appAccountId,
      amount: centsToGrant,
      reason: deps.LLM_CREDIT_REASONS.CRYPTO_PURCHASE,
      referenceId: fresh.id,
      idempotencyKey: makeLlmCryptoDepositIdempotencyKey(fresh.id),
    });
    if (!grantResult.ok) {
      throw new Error(`Credit grant failed: ${grantResult.reason}`);
    }

    const finalStatus = actualAtomic >
      deps.computeMaxAmountAtomic(fresh.expectedAmountAtomic, toleranceBps)
      ? "OVERPAID"
      : "SETTLED";
    const settledAt = new Date();
    await tx.llmCreditDeposit.update({
      where: { id: depositId },
      data: {
        status: finalStatus,
        signature,
        slot: options?.providedSlot,
        confirmationStatus: config.settlementCommitment,
        confirmedAt: settledAt,
        settledAt,
        receivedAmountAtomic: actualAtomic,
        creditedCents: centsToGrant,
        creditLedgerId: grantResult.ledgerId,
        failureReason: null,
        lastSyncAttemptAt: settledAt,
        syncAttemptCount: { increment: 1 },
      },
    });
    return {
      ok: true,
      signature,
      creditedCents: centsToGrant,
      ledgerId: grantResult.ledgerId ?? "",
    };
  });
}
