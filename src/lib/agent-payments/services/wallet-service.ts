import {
  Prisma,
  type TreasuryTransaction,
  type TreasuryTxType,
  type TreasuryWallet,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "./audit-service";

const MAX_MONEY_CENTS = 2_147_483_647;

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function assertPositiveSafeCents(amountCents: number, label: string): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_MONEY_CENTS) {
    throw new Error(`${label} must be an integer between 1 and ${MAX_MONEY_CENTS}`);
  }
}

export async function ensureTreasuryWallet(appAccountId: string) {
  const existing = await prisma.treasuryWallet.findUnique({ where: { appAccountId } });
  if (existing) return existing;

  try {
    const created = await prisma.treasuryWallet.create({
      data: {
        appAccountId,
        balanceUsdcCents: 0,
        reservedUsdcCents: 0,
        status: "ACTIVE",
      },
    });

    await writeAuditLog({
      appAccountId,
      action: "wallet.created",
      entityType: "treasury_wallet",
      entityId: created.id,
    });
    return created;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return prisma.treasuryWallet.findUniqueOrThrow({ where: { appAccountId } });
  }
}

export async function getWalletBalance(appAccountId: string) {
  const wallet = await ensureTreasuryWallet(appAccountId);
  return {
    walletId: wallet.id,
    status: wallet.status,
    balanceUsdcCents: wallet.balanceUsdcCents,
    reservedUsdcCents: wallet.reservedUsdcCents,
    availableUsdcCents: wallet.balanceUsdcCents - wallet.reservedUsdcCents,
    currency: "USDC" as const,
  };
}

async function loadWalletAfterMutation(
  tx: Prisma.TransactionClient,
  walletId: string,
): Promise<TreasuryWallet> {
  return tx.treasuryWallet.findUniqueOrThrow({ where: { id: walletId } });
}

export async function debitTreasuryAvailableInTx(
  tx: Prisma.TransactionClient,
  walletId: string,
  amountCents: number,
): Promise<TreasuryWallet | null> {
  assertPositiveSafeCents(amountCents, "Treasury debit amount");
  const changed = await tx.$executeRaw(Prisma.sql`
    UPDATE "treasury_wallets"
       SET "balance_usdc_cents" = "balance_usdc_cents" - ${amountCents},
           "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = ${walletId}
       AND "status" = 'ACTIVE'
       AND "balance_usdc_cents" - "reserved_usdc_cents" >= ${amountCents}
  `);
  return changed === 1 ? loadWalletAfterMutation(tx, walletId) : null;
}

export async function reserveTreasuryInTx(
  tx: Prisma.TransactionClient,
  walletId: string,
  amountCents: number,
): Promise<TreasuryWallet | null> {
  assertPositiveSafeCents(amountCents, "Treasury reserve amount");
  const changed = await tx.$executeRaw(Prisma.sql`
    UPDATE "treasury_wallets"
       SET "reserved_usdc_cents" = "reserved_usdc_cents" + ${amountCents},
           "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = ${walletId}
       AND "status" = 'ACTIVE'
       AND "balance_usdc_cents" - "reserved_usdc_cents" >= ${amountCents}
  `);
  return changed === 1 ? loadWalletAfterMutation(tx, walletId) : null;
}

export async function releaseTreasuryInTx(
  tx: Prisma.TransactionClient,
  walletId: string,
  amountCents: number,
): Promise<TreasuryWallet | null> {
  assertPositiveSafeCents(amountCents, "Treasury release amount");
  const changed = await tx.$executeRaw(Prisma.sql`
    UPDATE "treasury_wallets"
       SET "reserved_usdc_cents" = "reserved_usdc_cents" - ${amountCents},
           "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = ${walletId}
       AND "reserved_usdc_cents" >= ${amountCents}
  `);
  return changed === 1 ? loadWalletAfterMutation(tx, walletId) : null;
}

export async function spendTreasuryReservedInTx(
  tx: Prisma.TransactionClient,
  walletId: string,
  amountCents: number,
): Promise<TreasuryWallet | null> {
  assertPositiveSafeCents(amountCents, "Treasury reserved spend amount");
  const changed = await tx.$executeRaw(Prisma.sql`
    UPDATE "treasury_wallets"
       SET "balance_usdc_cents" = "balance_usdc_cents" - ${amountCents},
           "reserved_usdc_cents" = "reserved_usdc_cents" - ${amountCents},
           "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = ${walletId}
       AND "balance_usdc_cents" >= ${amountCents}
       AND "reserved_usdc_cents" >= ${amountCents}
  `);
  return changed === 1 ? loadWalletAfterMutation(tx, walletId) : null;
}

export type TreasuryIdempotencyExpectation = {
  appAccountId: string;
  type: TreasuryTxType;
  amountCents: number;
  agentId?: number | null;
  cardId?: string | null;
  merchant?: string | null;
  category?: string | null;
  reason?: string | null;
  providerTransactionId?: string | null;
  reserveTransactionId?: string | null;
};

export function assertTreasuryIdempotencyReplayMatches(
  transaction: TreasuryTransaction,
  expected: TreasuryIdempotencyExpectation,
): void {
  const metadataReserveTransactionId = (() => {
    if (!transaction.metadata || typeof transaction.metadata !== "object" || Array.isArray(transaction.metadata)) {
      return null;
    }
    const value = (transaction.metadata as Record<string, unknown>).reserveTransactionId;
    return typeof value === "string" ? value : null;
  })();
  const mismatch =
    transaction.appAccountId !== expected.appAccountId ||
    transaction.type !== expected.type ||
    transaction.amountCents !== expected.amountCents ||
    (expected.agentId !== undefined && transaction.agentId !== expected.agentId) ||
    (expected.cardId !== undefined && transaction.cardId !== expected.cardId) ||
    (expected.merchant !== undefined && transaction.merchant !== expected.merchant) ||
    (expected.category !== undefined && transaction.category !== expected.category) ||
    (expected.reason !== undefined && transaction.reason !== expected.reason) ||
    (expected.providerTransactionId !== undefined &&
      transaction.providerTransactionId !== expected.providerTransactionId) ||
    (expected.reserveTransactionId !== undefined &&
      metadataReserveTransactionId !== expected.reserveTransactionId);

  if (mismatch) {
    throw new Error("Idempotency key is already in use for a different treasury operation");
  }
}

export async function loadTreasuryIdempotencyReplay(
  idempotencyKey: string | undefined,
  expected: TreasuryIdempotencyExpectation,
) {
  if (!idempotencyKey) return null;
  const transaction = await prisma.treasuryTransaction.findUnique({ where: { idempotencyKey } });
  if (!transaction) return null;
  assertTreasuryIdempotencyReplayMatches(transaction, expected);
  const wallet = await prisma.treasuryWallet.findUniqueOrThrow({ where: { id: transaction.walletId } });
  return { wallet, transaction };
}

async function recoverTreasuryReplay<T>(
  error: unknown,
  idempotencyKey: string | undefined,
  expected: TreasuryIdempotencyExpectation,
  map: (replay: NonNullable<Awaited<ReturnType<typeof loadTreasuryIdempotencyReplay>>>) => T,
): Promise<T> {
  if (!idempotencyKey) throw error;
  // A duplicate can block on the winner's row lock and then fail a conditional
  // balance UPDATE before it reaches the unique transaction INSERT. Always
  // re-check the durable idempotency record after a failed mutation.
  const replay = await loadTreasuryIdempotencyReplay(idempotencyKey, expected);
  if (!replay) throw error;
  return map(replay);
}

export async function deposit(params: {
  appAccountId: string;
  amountCents: number;
  providerTransactionId?: string | null;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}) {
  assertPositiveSafeCents(params.amountCents, "Deposit amount");
  const expected: TreasuryIdempotencyExpectation = {
    appAccountId: params.appAccountId,
    type: "FUNDING",
    amountCents: params.amountCents,
    providerTransactionId: params.providerTransactionId ?? null,
  };
  const replay = await loadTreasuryIdempotencyReplay(params.idempotencyKey, expected);
  if (replay) return replay;
  const wallet = await ensureTreasuryWallet(params.appAccountId);
  if (wallet.status !== "ACTIVE") throw new Error("Wallet is not active");

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.treasuryWallet.update({
        where: { id: wallet.id },
        data: { balanceUsdcCents: { increment: params.amountCents } },
      });
      const transaction = await tx.treasuryTransaction.create({
        data: {
          appAccountId: params.appAccountId,
          walletId: wallet.id,
          type: "FUNDING",
          amountCents: params.amountCents,
          currency: "USDC",
          status: "SETTLED",
          providerTransactionId: params.providerTransactionId ?? null,
          idempotencyKey: params.idempotencyKey ?? null,
          balanceAfterCents: updated.balanceUsdcCents,
          metadata: params.metadata as Prisma.InputJsonValue | undefined,
        },
      });
      return { wallet: updated, transaction };
    });
  } catch (error) {
    return recoverTreasuryReplay(error, params.idempotencyKey, expected, (value) => value);
  }
}

export async function withdraw(params: {
  appAccountId: string;
  amountCents: number;
  idempotencyKey?: string;
  reason?: string;
}) {
  assertPositiveSafeCents(params.amountCents, "Withdraw amount");
  const expected: TreasuryIdempotencyExpectation = {
    appAccountId: params.appAccountId,
    type: "WITHDRAWAL",
    amountCents: params.amountCents,
    reason: params.reason ?? null,
  };
  const replay = await loadTreasuryIdempotencyReplay(params.idempotencyKey, expected);
  if (replay) return replay;
  const wallet = await ensureTreasuryWallet(params.appAccountId);

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await debitTreasuryAvailableInTx(tx, wallet.id, params.amountCents);
      if (!updated) throw new Error("Insufficient available balance");
      const transaction = await tx.treasuryTransaction.create({
        data: {
          appAccountId: params.appAccountId,
          walletId: wallet.id,
          type: "WITHDRAWAL",
          amountCents: params.amountCents,
          currency: "USDC",
          status: "SETTLED",
          reason: params.reason ?? null,
          idempotencyKey: params.idempotencyKey ?? null,
          balanceAfterCents: updated.balanceUsdcCents,
        },
      });
      return { wallet: updated, transaction };
    });
  } catch (error) {
    return recoverTreasuryReplay(error, params.idempotencyKey, expected, (value) => value);
  }
}

export async function reserveInTx(
  tx: Prisma.TransactionClient,
  params: {
    appAccountId: string;
    amountCents: number;
    agentId?: number | null;
    merchant?: string;
    category?: string;
    reason?: string;
    cardId?: string | null;
    idempotencyKey?: string;
  },
) {
  const wallet = await tx.treasuryWallet.findUnique({ where: { appAccountId: params.appAccountId } });
  if (!wallet || wallet.status !== "ACTIVE") throw new Error("Wallet is not active");
  const updated = await reserveTreasuryInTx(tx, wallet.id, params.amountCents);
  if (!updated) throw new Error("Insufficient available balance");
  const transaction = await tx.treasuryTransaction.create({
    data: {
      appAccountId: params.appAccountId,
      walletId: wallet.id,
      agentId: params.agentId ?? null,
      cardId: params.cardId ?? null,
      type: "RESERVE",
      amountCents: params.amountCents,
      merchant: params.merchant ?? null,
      category: params.category ?? null,
      reason: params.reason ?? null,
      status: "RESERVED",
      idempotencyKey: params.idempotencyKey ?? null,
      balanceAfterCents: updated.balanceUsdcCents,
    },
  });
  return { wallet: updated, transaction };
}

export async function reserve(params: Parameters<typeof reserveInTx>[1]) {
  assertPositiveSafeCents(params.amountCents, "Reserve amount");
  const expected: TreasuryIdempotencyExpectation = {
    appAccountId: params.appAccountId,
    type: "RESERVE",
    amountCents: params.amountCents,
    agentId: params.agentId ?? null,
    cardId: params.cardId ?? null,
    merchant: params.merchant ?? null,
    category: params.category ?? null,
    reason: params.reason ?? null,
  };
  const replay = await loadTreasuryIdempotencyReplay(params.idempotencyKey, expected);
  if (replay) return replay;
  await ensureTreasuryWallet(params.appAccountId);
  try {
    return await prisma.$transaction((tx) => reserveInTx(tx, params));
  } catch (error) {
    return recoverTreasuryReplay(error, params.idempotencyKey, expected, (value) => value);
  }
}

async function consumeLinkedReserveInTx(
  tx: Prisma.TransactionClient,
  params: {
    reserveTransactionId: string;
    appAccountId: string;
    walletId: string;
    amountCents: number;
    agentId?: number | null;
    cardId?: string | null;
    merchant?: string;
    category?: string;
  },
  status: "SETTLED" | "REVERSED",
): Promise<void> {
  const reserve = await tx.treasuryTransaction.findUnique({
    where: { id: params.reserveTransactionId },
    select: {
      appAccountId: true,
      walletId: true,
      type: true,
      amountCents: true,
      status: true,
      agentId: true,
      cardId: true,
      merchant: true,
      category: true,
    },
  });
  if (!reserve || reserve.appAccountId !== params.appAccountId || reserve.walletId !== params.walletId) {
    throw new Error("Linked reserve transaction does not belong to this treasury wallet");
  }
  if (reserve.type !== "RESERVE") throw new Error("Linked transaction is not a reserve");
  if (reserve.amountCents !== params.amountCents) {
    throw new Error("Linked reserve amount must exactly match the release or spend amount");
  }
  if (params.agentId !== undefined && reserve.agentId !== params.agentId) {
    throw new Error("Linked reserve belongs to a different agent");
  }
  if (params.cardId !== undefined && reserve.cardId !== params.cardId) {
    throw new Error("Linked reserve belongs to a different card");
  }
  if (params.merchant !== undefined && reserve.merchant !== params.merchant) {
    throw new Error("Linked reserve merchant does not match");
  }
  if (params.category !== undefined && reserve.category !== params.category) {
    throw new Error("Linked reserve category does not match");
  }
  if (reserve.status !== "RESERVED") throw new Error("Linked reserve is no longer active");

  const claimed = await tx.treasuryTransaction.updateMany({
    where: { id: params.reserveTransactionId, status: "RESERVED" },
    data: { status },
  });
  if (claimed.count !== 1) throw new Error("Linked reserve is no longer active");
}

export async function release(params: {
  appAccountId: string;
  amountCents: number;
  reserveTransactionId: string;
  idempotencyKey?: string;
}) {
  assertPositiveSafeCents(params.amountCents, "Release amount");
  const expected: TreasuryIdempotencyExpectation = {
    appAccountId: params.appAccountId,
    type: "RELEASE",
    amountCents: params.amountCents,
    reserveTransactionId: params.reserveTransactionId,
  };
  const replay = await loadTreasuryIdempotencyReplay(params.idempotencyKey, expected);
  if (replay) return replay;
  const wallet = await ensureTreasuryWallet(params.appAccountId);
  try {
    return await prisma.$transaction(async (tx) => {
      await consumeLinkedReserveInTx(tx, {
        reserveTransactionId: params.reserveTransactionId,
        appAccountId: params.appAccountId,
        walletId: wallet.id,
        amountCents: params.amountCents,
      }, "REVERSED");
      const updated = await releaseTreasuryInTx(tx, wallet.id, params.amountCents);
      if (!updated) throw new Error("Release exceeds reserved balance");
      const transaction = await tx.treasuryTransaction.create({
        data: {
          appAccountId: params.appAccountId,
          walletId: wallet.id,
          type: "RELEASE",
          amountCents: params.amountCents,
          status: "SETTLED",
          idempotencyKey: params.idempotencyKey ?? null,
          balanceAfterCents: updated.balanceUsdcCents,
          metadata: { reserveTransactionId: params.reserveTransactionId },
        },
      });
      return { wallet: updated, transaction };
    });
  } catch (error) {
    return recoverTreasuryReplay(error, params.idempotencyKey, expected, (value) => value);
  }
}

export async function spendFromReservedInTx(
  tx: Prisma.TransactionClient,
  params: {
    appAccountId: string;
    amountCents: number;
    agentId?: number | null;
    merchant?: string;
    category?: string;
    reason?: string;
    cardId?: string | null;
    providerTransactionId?: string | null;
    reserveTransactionId: string;
    idempotencyKey?: string;
  },
) {
  const wallet = await tx.treasuryWallet.findUnique({ where: { appAccountId: params.appAccountId } });
  if (!wallet) throw new Error("Wallet not found");
  await consumeLinkedReserveInTx(tx, {
    reserveTransactionId: params.reserveTransactionId,
    appAccountId: params.appAccountId,
    walletId: wallet.id,
    amountCents: params.amountCents,
    agentId: params.agentId,
    cardId: params.cardId,
    merchant: params.merchant,
    category: params.category,
  }, "SETTLED");
  const updated = await spendTreasuryReservedInTx(tx, wallet.id, params.amountCents);
  if (!updated) throw new Error("Spend exceeds reserved balance or wallet balance");
  const transaction = await tx.treasuryTransaction.create({
    data: {
      appAccountId: params.appAccountId,
      walletId: wallet.id,
      agentId: params.agentId ?? null,
      cardId: params.cardId ?? null,
      type: "SPEND",
      amountCents: params.amountCents,
      merchant: params.merchant ?? null,
      category: params.category ?? null,
      reason: params.reason ?? null,
      status: "SETTLED",
      providerTransactionId: params.providerTransactionId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      balanceAfterCents: updated.balanceUsdcCents,
      metadata: { reserveTransactionId: params.reserveTransactionId },
    },
  });
  return { wallet: updated, transaction };
}

export async function spendFromReserved(params: Parameters<typeof spendFromReservedInTx>[1]) {
  assertPositiveSafeCents(params.amountCents, "Spend amount");
  const expected: TreasuryIdempotencyExpectation = {
    appAccountId: params.appAccountId,
    type: "SPEND",
    amountCents: params.amountCents,
    agentId: params.agentId ?? null,
    cardId: params.cardId ?? null,
    merchant: params.merchant ?? null,
    category: params.category ?? null,
    reason: params.reason ?? null,
    providerTransactionId: params.providerTransactionId ?? null,
    reserveTransactionId: params.reserveTransactionId,
  };
  const replay = await loadTreasuryIdempotencyReplay(params.idempotencyKey, expected);
  if (replay) return replay;
  await ensureTreasuryWallet(params.appAccountId);
  try {
    return await prisma.$transaction((tx) => spendFromReservedInTx(tx, params));
  } catch (error) {
    return recoverTreasuryReplay(error, params.idempotencyKey, expected, (value) => value);
  }
}
