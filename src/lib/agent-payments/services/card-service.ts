import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  cardIssuanceRequiresPayment,
  getCardIssuanceFeeCents,
  getCardIssuanceQuote,
  isCardIssuanceDevBypassActive,
} from "../config";
import { getCardIssuerProvider, isKripicardIssuerActive } from "../providers";
import { issueAgentPaymentCard } from "./agent-card-issue-service";
import { writeAuditLog } from "./audit-service";
import {
  assertFreezePinForCard,
  CardPinInvalidError,
  CardPinRequiredError,
} from "./card-pin-service";
import {
  debitTreasuryAvailableInTx,
  ensureTreasuryWallet,
  getWalletBalance,
  loadTreasuryIdempotencyReplay,
  type TreasuryIdempotencyExpectation,
} from "./wallet-service";
import { assertAccountVerifiedForCardIssuance } from "@/lib/verification/account-verification-service";
import { isCardIssuanceEnabled } from "@/lib/verification/config";

export { CardPinInvalidError, CardPinRequiredError };

const MAX_MONEY_CENTS = 2_147_483_647;

export class CardReconciliationRequiredError extends Error {
  readonly code = "card_reconciliation_required" as const;
  readonly operation: "freeze" | "unfreeze" | "cancel";
  readonly cardId: string;

  constructor(
    operation: "freeze" | "unfreeze" | "cancel",
    cardId: string,
    cause: unknown,
  ) {
    super(`Card ${operation} succeeded at the provider, but local state could not be saved; reconciliation is required`, {
      cause,
    });
    this.name = "CardReconciliationRequiredError";
    this.operation = operation;
    this.cardId = cardId;
  }
}

export class CardIssuancePaymentRequiredError extends Error {
  readonly code = "insufficient_balance" as const;
  readonly feeCents: number;
  readonly availableCents: number;

  constructor(feeCents: number, availableCents: number) {
    super("Insufficient treasury balance to issue a card");
    this.name = "CardIssuancePaymentRequiredError";
    this.feeCents = feeCents;
    this.availableCents = availableCents;
  }
}

export async function getCard(appAccountId: string, cardId?: string) {
  if (isKripicardIssuerActive()) {
    const arCard = cardId
      ? await prisma.agentKripicardCard.findFirst({
          where: { id: cardId, appAccountId, status: { not: "CANCELLED" } },
        })
      : await prisma.agentKripicardCard.findFirst({
          where: { appAccountId, status: { not: "CANCELLED" } },
          orderBy: { createdAt: "desc" },
        });
    if (!arCard) return null;
    return mapArCardRecord(arCard, appAccountId);
  }
  return prisma.paymentCard.findUnique({ where: { appAccountId } });
}

function mapArCardRecord(
  arCard: {
    id: string;
    kripicardCardId: string;
    lastFour: string;
    brand: string;
    bin: string;
    nameOnCard: string;
    status: string;
    initialAmountUsd: number;
    freezePinHash?: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  appAccountId: string,
) {
  return {
    id: arCard.id,
    appAccountId,
    providerCardId: arCard.kripicardCardId,
    providerName: "ar",
    lastFour: arCard.lastFour,
    brand: arCard.brand,
    bin: arCard.bin,
    nameOnCard: arCard.nameOnCard,
    initialAmountUsd: arCard.initialAmountUsd,
    pinSet: Boolean(arCard.freezePinHash),
    expiryMonth: null as number | null,
    expiryYear: null as number | null,
    status: arCard.status,
    createdAt: arCard.createdAt,
    updatedAt: arCard.updatedAt,
  };
}

export async function listArCards(appAccountId: string) {
  const cards = await prisma.agentKripicardCard.findMany({
    where: { appAccountId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
  });
  return cards.map((card) => mapArCardRecord(card, appAccountId));
}

async function getArCardRecord(appAccountId: string, cardId?: string) {
  const card = cardId
    ? await prisma.agentKripicardCard.findFirst({
        where: { id: cardId, appAccountId },
      })
    : await prisma.agentKripicardCard.findFirst({
        where: { appAccountId, status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" },
      });
  if (!card) throw new Error(cardId ? "Card not found" : "No card on account");
  return card;
}

export async function getCardDashboardState(appAccountId: string) {
  const [cards, card, balance, issuance] = await Promise.all([
    isKripicardIssuerActive() ? listArCards(appAccountId) : Promise.resolve([]),
    getCard(appAccountId),
    getWalletBalance(appAccountId),
    Promise.resolve(getCardIssuanceQuote()),
  ]);
  return {
    cards,
    card,
    balance,
    issuance: {
      ...issuance,
      canAfford:
        !issuance.requiresPayment ||
        balance.availableUsdcCents >= issuance.feeCents,
    },
  };
}

async function assertIssuanceAgent(appAccountId: string, agentId: number) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, ownerAccountId: appAccountId, isActive: true },
    select: { id: true, name: true },
  });
  if (!agent) {
    throw new Error("Select an active agent owned by this account");
  }
  return agent;
}

async function chargeCardIssuanceFee(params: {
  appAccountId: string;
  agentId?: number | null;
  feeCents: number;
  idempotencyKey: string;
}) {
  if (
    !Number.isSafeInteger(params.feeCents) ||
    params.feeCents < 0 ||
    params.feeCents > MAX_MONEY_CENTS
  ) {
    throw new Error(`feeCents must be an integer between 0 and ${MAX_MONEY_CENTS}`);
  }
  if (params.feeCents === 0) return null;

  const expected: TreasuryIdempotencyExpectation = {
    appAccountId: params.appAccountId,
    type: "CARD_ISSUE",
    amountCents: params.feeCents,
    agentId: params.agentId ?? null,
    reason: "card_issuance_fee",
  };
  const replay = await loadTreasuryIdempotencyReplay(params.idempotencyKey, expected);
  if (replay) return replay.transaction;

  const wallet = await ensureTreasuryWallet(params.appAccountId);

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await debitTreasuryAvailableInTx(tx, wallet.id, params.feeCents);
      if (!updated) {
        const current = await tx.treasuryWallet.findUniqueOrThrow({ where: { id: wallet.id } });
        throw new CardIssuancePaymentRequiredError(
          params.feeCents,
          current.balanceUsdcCents - current.reservedUsdcCents,
        );
      }
      return tx.treasuryTransaction.create({
        data: {
          appAccountId: params.appAccountId,
          walletId: wallet.id,
          agentId: params.agentId ?? null,
          type: "CARD_ISSUE",
          amountCents: params.feeCents,
          currency: "USD",
          status: "SETTLED",
          reason: "card_issuance_fee",
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

async function findExistingIssuedCard(appAccountId: string, _agentId?: number | null) {
  if (isKripicardIssuerActive()) {
    return null;
  }

  const paymentCard = await prisma.paymentCard.findUnique({
    where: { appAccountId },
  });
  if (paymentCard && paymentCard.status !== "CANCELLED") return paymentCard;
  return null;
}

export async function issueCard(params: {
  appAccountId: string;
  agentId?: number | null;
  displayName?: string;
  amountUsd?: number;
  bin?: string;
  email?: string;
  dateOfBirth?: string;
  idempotencyKey?: string;
}) {
  if (!isCardIssuanceEnabled()) {
    throw new Error("Card issuance is currently disabled.");
  }
  await assertAccountVerifiedForCardIssuance(params.appAccountId);

  const agent =
    params.agentId != null
      ? await assertIssuanceAgent(params.appAccountId, params.agentId)
      : null;
  await ensureTreasuryWallet(params.appAccountId);

  const feeCents = cardIssuanceRequiresPayment() ? getCardIssuanceFeeCents() : 0;
  const idempotencyKey = params.idempotencyKey ?? randomUUID();
  const amountUsd = params.amountUsd ?? 10;

  if (!isKripicardIssuerActive() && feeCents > 0) {
    const balance = await getWalletBalance(params.appAccountId);
    if (balance.availableUsdcCents < feeCents) {
      throw new CardIssuancePaymentRequiredError(feeCents, balance.availableUsdcCents);
    }
  }

  const existing = await findExistingIssuedCard(params.appAccountId, agent?.id);
  if (existing) {
    return {
      card: existing,
      created: false,
      agent,
      issuance: getCardIssuanceQuote(),
      feeChargedCents: 0,
    };
  }

  const issuer = getCardIssuerProvider();
  const issued = await issueAgentPaymentCard({
    appAccountId: params.appAccountId,
    agentId: agent?.id ?? null,
    agentName: agent?.name,
    displayName: params.displayName ?? agent?.name ?? "AR AGENT",
    amountUsd,
    bin: params.bin,
    email: params.email,
    dateOfBirth: params.dateOfBirth,
    idempotencyKey,
  });

  if (!isKripicardIssuerActive()) {
    const paymentCard = await prisma.paymentCard.upsert({
      where: { appAccountId: params.appAccountId },
      create: {
        appAccountId: params.appAccountId,
        providerCardId: issued.providerCardId,
        providerName: issuer.name,
        lastFour: issued.lastFour,
        brand: issued.brand,
        expiryMonth: issued.expiryMonth,
        expiryYear: issued.expiryYear,
        status: issued.status === "active" ? "ACTIVE" : "PENDING",
      },
      update: {
        providerCardId: issued.providerCardId,
        providerName: issuer.name,
        lastFour: issued.lastFour,
        brand: issued.brand,
        expiryMonth: issued.expiryMonth,
        expiryYear: issued.expiryYear,
        status: issued.status === "active" ? "ACTIVE" : "PENDING",
      },
    });

    return {
      card: paymentCard,
      created: true,
      agent,
      issuance: getCardIssuanceQuote(),
      feeChargedCents: 0,
    };
  }

  const arCard = await prisma.agentKripicardCard.findUniqueOrThrow({
    where: { kripicardCardId: issued.providerCardId },
  });

  const feeTransaction = await chargeCardIssuanceFee({
    appAccountId: params.appAccountId,
    agentId: agent?.id ?? null,
    feeCents,
    idempotencyKey: `card-issue-fee:${idempotencyKey}`,
  });

  if (feeCents === 0) {
    const wallet = await prisma.treasuryWallet.findUniqueOrThrow({
      where: { appAccountId: params.appAccountId },
    });
    const zeroFeeIdempotencyKey = `card-issue:${idempotencyKey}`;
    const zeroFeeExpectation: TreasuryIdempotencyExpectation = {
      appAccountId: params.appAccountId,
      type: "CARD_ISSUE",
      amountCents: 0,
      agentId: agent?.id ?? null,
      reason: isCardIssuanceDevBypassActive() ? "card_issued_dev_bypass" : "card_issued",
    };
    const zeroFeeReplay = await loadTreasuryIdempotencyReplay(
      zeroFeeIdempotencyKey,
      zeroFeeExpectation,
    );
    if (!zeroFeeReplay) {
      try {
        await prisma.treasuryTransaction.create({
          data: {
            appAccountId: params.appAccountId,
            walletId: wallet.id,
            agentId: agent?.id ?? null,
            type: "CARD_ISSUE",
            amountCents: 0,
            status: "SETTLED",
            reason: zeroFeeExpectation.reason,
            idempotencyKey: zeroFeeIdempotencyKey,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        const replay = await loadTreasuryIdempotencyReplay(zeroFeeIdempotencyKey, zeroFeeExpectation);
        if (!replay) throw error;
      }
    }
  }

  await writeAuditLog({
    appAccountId: params.appAccountId,
    action: "card.issued",
    entityType: "agent_kripicard_card",
    entityId: arCard.id,
    metadata: {
      provider: issuer.name,
      lastFour: issued.lastFour,
      agentId: agent?.id ?? null,
      bin: arCard.bin,
      amountUsd,
      feeCents,
      sharedAccountCard: false,
      devBypass: isCardIssuanceDevBypassActive(),
    },
  });

  return {
    card: arCard,
    created: true,
    agent,
    issuance: getCardIssuanceQuote(),
    feeChargedCents: feeTransaction?.amountCents ?? 0,
  };
}

function logCardReconciliationRequired(input: {
  appAccountId: string;
  cardId: string;
  providerCardId: string;
  operation: "freeze" | "unfreeze" | "cancel";
  error: unknown;
}) {
  console.error("[agent-payments] card reconciliation required", {
    event: "card.reconciliation_required",
    appAccountId: input.appAccountId,
    cardId: input.cardId,
    providerCardId: input.providerCardId,
    operation: input.operation,
    error: input.error instanceof Error ? input.error.message : String(input.error),
  });
}

function cardReconciliationRequiredError(
  input: {
    appAccountId: string;
    cardId: string;
    providerCardId: string;
    operation: "freeze" | "unfreeze" | "cancel";
  },
  error: unknown,
): CardReconciliationRequiredError {
  logCardReconciliationRequired({ ...input, error });
  return new CardReconciliationRequiredError(input.operation, input.cardId, error);
}

async function persistArCardStatusAfterProviderMutation(
  input: {
    appAccountId: string;
    cardId: string;
    providerCardId: string;
    operation: "freeze" | "unfreeze" | "cancel";
    status: "ACTIVE" | "FROZEN" | "CANCELLED";
  },
) {
  try {
    return await prisma.agentKripicardCard.update({
      where: { id: input.cardId },
      data: { status: input.status },
    });
  } catch (error) {
    throw cardReconciliationRequiredError(input, error);
  }
}

export async function freezeAgentCard(
  appAccountId: string,
  cardId: string,
  pin?: string,
) {
  const card = await getArCardRecord(appAccountId, cardId);
  if (card.status === "CANCELLED") throw new Error("Card is cancelled");
  await assertFreezePinForCard(card, pin);

  const issuer = getCardIssuerProvider();
  await issuer.freezeCard(card.kripicardCardId);
  const updated = await persistArCardStatusAfterProviderMutation({
    appAccountId,
    cardId: card.id,
    providerCardId: card.kripicardCardId,
    operation: "freeze",
    status: "FROZEN",
  });
  await writeAuditLog({
    appAccountId,
    action: "card.frozen",
    entityType: "agent_kripicard_card",
    entityId: card.id,
  });
  return updated;
}

export async function unfreezeAgentCard(
  appAccountId: string,
  cardId: string,
  pin?: string,
) {
  const card = await getArCardRecord(appAccountId, cardId);
  if (card.status === "CANCELLED") throw new Error("Card is cancelled");
  await assertFreezePinForCard(card, pin);

  const issuer = getCardIssuerProvider();
  await issuer.unfreezeCard(card.kripicardCardId);
  const updated = await persistArCardStatusAfterProviderMutation({
    appAccountId,
    cardId: card.id,
    providerCardId: card.kripicardCardId,
    operation: "unfreeze",
    status: "ACTIVE",
  });
  await writeAuditLog({
    appAccountId,
    action: "card.unfrozen",
    entityType: "agent_kripicard_card",
    entityId: card.id,
  });
  return updated;
}

export async function cancelAgentCard(appAccountId: string, cardId: string) {
  const card = await getArCardRecord(appAccountId, cardId);

  const issuer = getCardIssuerProvider();
  await issuer.cancelCard(card.kripicardCardId);
  const updated = await persistArCardStatusAfterProviderMutation({
    appAccountId,
    cardId: card.id,
    providerCardId: card.kripicardCardId,
    operation: "cancel",
    status: "CANCELLED",
  });

  await writeAuditLog({
    appAccountId,
    action: "card.cancelled",
    entityType: "agent_kripicard_card",
    entityId: card.id,
  });
  return updated;
}

/** @deprecated Account-scoped freeze — prefer freezeAgentCard with cardId for AR cards. */
export async function freezeCard(appAccountId: string, cardId?: string, pin?: string) {
  if (!isKripicardIssuerActive()) {
    const card = await prisma.paymentCard.findUnique({ where: { appAccountId } });
    if (!card) throw new Error("No card on account");
    const issuer = getCardIssuerProvider();
    await issuer.freezeCard(card.providerCardId);
    try {
      return await prisma.paymentCard.update({
        where: { id: card.id },
        data: { status: "FROZEN" },
      });
    } catch (error) {
      throw cardReconciliationRequiredError({
        appAccountId,
        cardId: card.id,
        providerCardId: card.providerCardId,
        operation: "freeze",
      }, error);
    }
  }

  const card = await getArCardRecord(appAccountId, cardId);
  return freezeAgentCard(appAccountId, card.id, pin);
}

export async function unfreezeCard(appAccountId: string, cardId?: string, pin?: string) {
  if (!isKripicardIssuerActive()) {
    const card = await prisma.paymentCard.findUnique({ where: { appAccountId } });
    if (!card) throw new Error("No card on account");
    const issuer = getCardIssuerProvider();
    await issuer.unfreezeCard(card.providerCardId);
    try {
      return await prisma.paymentCard.update({
        where: { id: card.id },
        data: { status: "ACTIVE" },
      });
    } catch (error) {
      throw cardReconciliationRequiredError({
        appAccountId,
        cardId: card.id,
        providerCardId: card.providerCardId,
        operation: "unfreeze",
      }, error);
    }
  }

  const card = await getArCardRecord(appAccountId, cardId);
  return unfreezeAgentCard(appAccountId, card.id, pin);
}

export async function cancelCard(appAccountId: string, cardId?: string) {
  if (!isKripicardIssuerActive()) {
    const card = await prisma.paymentCard.findUnique({ where: { appAccountId } });
    if (!card) throw new Error("No card on account");
    const issuer = getCardIssuerProvider();
    await issuer.cancelCard(card.providerCardId);
    try {
      return await prisma.paymentCard.update({
        where: { id: card.id },
        data: { status: "CANCELLED" },
      });
    } catch (error) {
      throw cardReconciliationRequiredError({
        appAccountId,
        cardId: card.id,
        providerCardId: card.providerCardId,
        operation: "cancel",
      }, error);
    }
  }

  const card = await getArCardRecord(appAccountId, cardId);
  return cancelAgentCard(appAccountId, card.id);
}

export async function reconcileCardProviderState(appAccountId: string, cardId?: string) {
  const issuer = getCardIssuerProvider();
  if (isKripicardIssuerActive()) {
    const card = await getArCardRecord(appAccountId, cardId);
    const remote = await issuer.getCard(card.kripicardCardId);
    if (!remote) throw new Error("Card no longer exists at the issuer");
    const status = remote.status === "frozen"
      ? "FROZEN"
      : remote.status === "cancelled"
        ? "CANCELLED"
        : remote.status === "active"
          ? "ACTIVE"
          : "PENDING";
    const updated = await prisma.agentKripicardCard.update({
      where: { id: card.id },
      data: { status },
    });
    await writeAuditLog({
      appAccountId,
      action: "card.reconciled",
      entityType: "agent_kripicard_card",
      entityId: card.id,
      metadata: { providerStatus: remote.status, localStatus: status },
    });
    return updated;
  }

  const card = await prisma.paymentCard.findUnique({ where: { appAccountId } });
  if (!card) throw new Error("No card on account");
  const remote = await issuer.getCard(card.providerCardId);
  if (!remote) throw new Error("Card no longer exists at the issuer");
  const status = remote.status === "frozen"
    ? "FROZEN"
    : remote.status === "cancelled"
      ? "CANCELLED"
      : remote.status === "active"
        ? "ACTIVE"
        : "PENDING";
  const updated = await prisma.paymentCard.update({
    where: { id: card.id },
    data: { status },
  });
  await writeAuditLog({
    appAccountId,
    action: "card.reconciled",
    entityType: "payment_card",
    entityId: card.id,
    metadata: { providerStatus: remote.status, localStatus: status },
  });
  return updated;
}

export async function getCardDetails(appAccountId: string, cardId?: string) {
  if (!isKripicardIssuerActive()) {
    const card = await prisma.paymentCard.findUnique({ where: { appAccountId } });
    if (!card) throw new Error("No card on account");
    const issuer = getCardIssuerProvider();
    const reveal = await issuer.getCardDetails(card.providerCardId);
    return {
      card: {
        id: card.id,
        lastFour: card.lastFour,
        brand: card.brand,
        status: card.status,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
      },
      reveal,
      credentials:
        reveal.revealMode === "inline" && reveal.credentials
          ? {
              pan: reveal.credentials.pan,
              cvv: reveal.credentials.cvv,
              expiry: `${String(reveal.credentials.expiryMonth).padStart(2, "0")}/${String(reveal.credentials.expiryYear).slice(-2)}`,
              cardholderName: reveal.credentials.cardholderName ?? "AR AGENT",
            }
          : null,
    };
  }

  const card = await getArCardRecord(appAccountId, cardId);
  if (card.status === "CANCELLED") throw new Error("Card is cancelled");

  const issuer = getCardIssuerProvider();
  const reveal = await issuer.getCardDetails(card.kripicardCardId);

  await writeAuditLog({
    appAccountId,
    action: "card.details_requested",
    entityType: "agent_kripicard_card",
    entityId: card.id,
    metadata: { revealMode: reveal.revealMode },
  });

  return {
    card: {
      id: card.id,
      lastFour: card.lastFour,
      brand: card.brand,
      status: card.status,
      expiryMonth: null,
      expiryYear: null,
    },
    reveal,
    credentials:
      reveal.revealMode === "inline" && reveal.credentials
        ? {
            pan: reveal.credentials.pan,
            cvv: reveal.credentials.cvv,
            expiry:
              reveal.credentials.expiryDisplay ??
              `${String(reveal.credentials.expiryMonth).padStart(2, "0")}/${String(
                reveal.credentials.expiryYear,
              ).slice(-2)}`,
            cardholderName: reveal.credentials.cardholderName ?? "AR AGENT",
          }
        : null,
    balanceUsd: reveal.balanceUsd,
  };
}

export async function getCardTransactions(appAccountId: string, cardId?: string) {
  const card = await getArCardRecord(appAccountId, cardId);
  const issuer = getCardIssuerProvider();
  if (!issuer.getCardTransactions) return [];
  return issuer.getCardTransactions(card.kripicardCardId);
}
