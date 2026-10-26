import { prisma } from "@/lib/db";
import { getKripicardCardIssuer, isKripicardIssuerActive } from "../providers";
import {
  debitTreasuryAvailableInTx,
  ensureTreasuryWallet,
  loadTreasuryIdempotencyReplay,
  type TreasuryIdempotencyExpectation,
} from "./wallet-service";

const MAX_MONEY_CENTS = 2_147_483_647;

export class InsufficientTreasuryBalanceError extends Error {
  readonly code = "insufficient_balance" as const;
  readonly availableCents: number;
  readonly requiredCents: number;

  constructor(requiredCents: number, availableCents: number) {
    super("Insufficient treasury balance");
    this.name = "InsufficientTreasuryBalanceError";
    this.requiredCents = requiredCents;
    this.availableCents = availableCents;
  }
}

export async function chargeTreasuryForCardOperation(params: {
  appAccountId: string;
  agentId?: number | null;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}) {
  if (
    !Number.isSafeInteger(params.amountCents) ||
    params.amountCents <= 0 ||
    params.amountCents > MAX_MONEY_CENTS
  ) {
    throw new Error(`amountCents must be an integer between 1 and ${MAX_MONEY_CENTS}`);
  }

  const expected: TreasuryIdempotencyExpectation = {
    appAccountId: params.appAccountId,
    type: "ADJUSTMENT",
    amountCents: params.amountCents,
    agentId: params.agentId ?? null,
    reason: params.reason,
  };
  const replay = await loadTreasuryIdempotencyReplay(params.idempotencyKey, expected);
  if (replay) return replay.transaction;

  const wallet = await ensureTreasuryWallet(params.appAccountId);

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await debitTreasuryAvailableInTx(tx, wallet.id, params.amountCents);
      if (!updated) {
        const current = await tx.treasuryWallet.findUniqueOrThrow({ where: { id: wallet.id } });
        throw new InsufficientTreasuryBalanceError(
          params.amountCents,
          current.balanceUsdcCents - current.reservedUsdcCents,
        );
      }
      return tx.treasuryTransaction.create({
        data: {
          appAccountId: params.appAccountId,
          walletId: wallet.id,
          agentId: params.agentId ?? null,
          type: "ADJUSTMENT",
          amountCents: params.amountCents,
          currency: "USD",
          status: "SETTLED",
          reason: params.reason,
          idempotencyKey: params.idempotencyKey,
          balanceAfterCents: updated.balanceUsdcCents,
        },
      });
    });
  } catch (error) {
    const replayAfterFailure = await loadTreasuryIdempotencyReplay(params.idempotencyKey, expected);
    if (replayAfterFailure) return replayAfterFailure.transaction;
    throw error;
  }
}

export async function fundAgentArCardFromTreasury(params: {
  appAccountId: string;
  agentId?: number | null;
  cardId?: string;
  amountCents: number;
  idempotencyKey?: string;
}) {
  if (
    !Number.isSafeInteger(params.amountCents) ||
    params.amountCents < 1_000 ||
    params.amountCents > MAX_MONEY_CENTS
  ) {
    throw new Error(`Card top-up amount must be an integer between 1000 and ${MAX_MONEY_CENTS} cents`);
  }
  const amountUsd = params.amountCents / 100;

  const card = params.cardId
    ? await prisma.agentKripicardCard.findFirst({
        where: { id: params.cardId, appAccountId: params.appAccountId },
      })
    : await prisma.agentKripicardCard.findFirst({
        where: { appAccountId: params.appAccountId, status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" },
      });
  if (!card || card.status === "CANCELLED") {
    throw new Error("Issue an AR card before loading balance.");
  }

  const idempotencyKey =
    params.idempotencyKey ??
    `ar-fund:${params.appAccountId}:${params.amountCents}:${Date.now()}`;

  if (!isKripicardIssuerActive()) {
    await chargeTreasuryForCardOperation({
      appAccountId: params.appAccountId,
      agentId: params.agentId ?? null,
      amountCents: params.amountCents,
      reason: "ar_card_fund",
      idempotencyKey,
    });
  }

  const issuer = getKripicardCardIssuer();
  const funded = await issuer.fundCard({
    cardId: card.kripicardCardId,
    amountUsd,
  });

  const details = await issuer.getCardDetails(card.kripicardCardId);

  return {
    card,
    funded,
    balanceUsd: details.balanceUsd ?? null,
  };
}
