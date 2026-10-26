import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "./audit-service";
import { normalizeSpendingCategories, validateSpendRequest } from "./spending-policy-service";
import {
  assertTreasuryIdempotencyReplayMatches,
  ensureTreasuryWallet,
  reserveInTx,
  spendFromReservedInTx,
} from "./wallet-service";

const MAX_MONEY_CENTS = 2_147_483_647;

export type SpendRequest = {
  appAccountId: string;
  agentId: number;
  amountCents: number;
  merchant: string;
  category: string;
  reason: string;
  idempotencyKey?: string;
};

/** Agent spending: User → Account Wallet → Account Card → policy-governed agent spend. */
export async function requestAgentSpend(params: SpendRequest) {
  if (
    !Number.isSafeInteger(params.amountCents) ||
    params.amountCents <= 0 ||
    params.amountCents > MAX_MONEY_CENTS
  ) {
    throw new Error(`amountCents must be an integer between 1 and ${MAX_MONEY_CENTS}`);
  }
  const merchant = params.merchant.trim();
  const category = normalizeSpendingCategories([params.category], "category")[0];
  const reason = params.reason.trim();
  if (!merchant) throw new Error("merchant is required");
  if (!category) throw new Error("category is required");
  if (!reason) throw new Error("reason is required");

  const idempotencyKey = params.idempotencyKey ?? `spend:${params.agentId}:${randomUUID()}`;
  await ensureTreasuryWallet(params.appAccountId);

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`treasury-spend:${params.appAccountId}`}, 0))
    `);

    const existing = await tx.treasuryTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) {
      assertTreasuryIdempotencyReplayMatches(existing, {
        appAccountId: params.appAccountId,
        type: "SPEND",
        amountCents: params.amountCents,
        agentId: params.agentId,
        merchant,
        category,
        reason,
      });
      return { kind: "duplicate" as const, transaction: existing };
    }

    const [agent, card] = await Promise.all([
      tx.agent.findFirst({
        where: { id: params.agentId, ownerAccountId: params.appAccountId },
        select: { id: true, name: true, isActive: true },
      }),
      tx.paymentCard.findUnique({ where: { appAccountId: params.appAccountId } }),
    ]);
    if (!agent || !agent.isActive) throw new Error("Agent not found or not owned by this account");

    const validation = await validateSpendRequest({
      appAccountId: params.appAccountId,
      amountCents: params.amountCents,
      category,
      actor: "agent",
      cardStatus: card?.status ?? null,
    }, tx);
    if (validation.ok === false) return { kind: "rejected" as const, reasons: validation.reasons };
    if (!card || card.status !== "ACTIVE") {
      return {
        kind: "rejected" as const,
        reasons: ["An active payment card is required before agents can spend"],
      };
    }

    const reserved = await reserveInTx(tx, {
      appAccountId: params.appAccountId,
      amountCents: params.amountCents,
      agentId: params.agentId,
      merchant,
      category,
      reason,
      cardId: card.id,
      idempotencyKey: `${idempotencyKey}:reserve`,
    });
    const spent = await spendFromReservedInTx(tx, {
      appAccountId: params.appAccountId,
      amountCents: params.amountCents,
      agentId: params.agentId,
      merchant,
      category,
      reason,
      cardId: card.id,
      reserveTransactionId: reserved.transaction.id,
      idempotencyKey,
    });
    return { kind: "settled" as const, ...spent };
  });

  if (outcome.kind === "duplicate") return { transaction: outcome.transaction, duplicate: true };
  if (outcome.kind === "rejected") {
    await writeAuditLog({
      appAccountId: params.appAccountId,
      action: "spend.rejected",
      entityType: "agent",
      entityId: String(params.agentId),
      metadata: { reasons: outcome.reasons, amountCents: params.amountCents },
    });
    return { rejected: true as const, reasons: outcome.reasons };
  }

  await writeAuditLog({
    appAccountId: params.appAccountId,
    action: "spend.settled",
    entityType: "treasury_transaction",
    entityId: outcome.transaction.id,
    metadata: { agentId: params.agentId, amountCents: params.amountCents, merchant, category },
  });

  return {
    rejected: false as const,
    duplicate: false,
    transaction: outcome.transaction,
    wallet: outcome.wallet,
  };
}
