import { Prisma, type AgentStablecoinLedgerEntryType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  debitTreasuryAvailableInTx,
  ensureTreasuryWallet,
  loadTreasuryIdempotencyReplay,
  type TreasuryIdempotencyExpectation,
} from "./wallet-service";

const LITHIC_AUTH_REFERENCE = "lithic_asa";
const MARQETA_JIT_AUTH_REFERENCE = "marqeta_jit";
const MARQETA_JIT_REFUND_REFERENCE = "marqeta_jit_refund";
const MARQETA_EVENT_REFUND_REFERENCE = "marqeta_event_refund";
const MAX_MONEY_CENTS = 2_147_483_647;

export interface AgentLedgerBalance {
  agentId: number;
  balanceUsdcCents: number;
  reservedUsdcCents: number;
  availableUsdcCents: number;
}

function positiveSafeCents(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_MONEY_CENTS) {
    throw new Error(`${label} must be an integer between 1 and ${MAX_MONEY_CENTS}`);
  }
  return value;
}


function toLedgerBalance(agentId: number, ledger: { balanceUsdcCents: number; reservedUsdcCents: number }): AgentLedgerBalance {
  return {
    agentId,
    balanceUsdcCents: ledger.balanceUsdcCents,
    reservedUsdcCents: ledger.reservedUsdcCents,
    availableUsdcCents: ledger.balanceUsdcCents - ledger.reservedUsdcCents,
  };
}

async function findReferenceEntry(referenceType: string, referenceId: string) {
  return prisma.agentStablecoinLedgerEntry.findFirst({
    where: { referenceType, referenceId },
    include: { ledger: { select: { agentId: true } } },
  });
}

function assertReferenceReplay(
  entry: NonNullable<Awaited<ReturnType<typeof findReferenceEntry>>>,
  expected: {
    agentId: number;
    type: AgentStablecoinLedgerEntryType;
    amountCents: number;
  },
): void {
  if (
    entry.ledger.agentId !== expected.agentId ||
    entry.type !== expected.type ||
    entry.amountCents !== expected.amountCents
  ) {
    throw new Error("Ledger reference is already in use for a different operation");
  }
}

async function debitAgentLedgerAvailableInTx(
  tx: Prisma.TransactionClient,
  ledgerId: string,
  amountCents: number,
) {
  const changed = await tx.$executeRaw(Prisma.sql`
    UPDATE "agent_stablecoin_ledgers"
       SET "balance_usdc_cents" = "balance_usdc_cents" - ${amountCents},
           "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = ${ledgerId}
       AND "balance_usdc_cents" - "reserved_usdc_cents" >= ${amountCents}
  `);
  return changed === 1
    ? tx.agentStablecoinLedger.findUniqueOrThrow({ where: { id: ledgerId } })
    : null;
}

export async function getOrCreateAgentStablecoinLedger(agentId: number) {
  return prisma.agentStablecoinLedger.upsert({ where: { agentId }, create: { agentId }, update: {} });
}

export async function getAgentLedgerBalance(agentId: number): Promise<AgentLedgerBalance> {
  return toLedgerBalance(agentId, await getOrCreateAgentStablecoinLedger(agentId));
}

export async function creditAgentStablecoinLedger(params: {
  agentId: number;
  amountCents: number;
  referenceType?: string;
  referenceId?: string;
  note?: string;
}): Promise<AgentLedgerBalance> {
  positiveSafeCents(params.amountCents, "credit amount");
  const referenceType = params.referenceType?.trim() || null;
  const referenceId = params.referenceId?.trim() || null;
  if ((referenceType == null) !== (referenceId == null)) {
    throw new Error("referenceType and referenceId must be supplied together");
  }
  if (referenceType && referenceId) {
    const existing = await findReferenceEntry(referenceType, referenceId);
    if (existing) {
      assertReferenceReplay(existing, {
        agentId: params.agentId,
        type: "CREDIT",
        amountCents: params.amountCents,
      });
      return getAgentLedgerBalance(params.agentId);
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const ledger = await tx.agentStablecoinLedger.upsert({
        where: { agentId: params.agentId },
        create: { agentId: params.agentId },
        update: {},
      });
      const updated = await tx.agentStablecoinLedger.update({
        where: { id: ledger.id },
        data: { balanceUsdcCents: { increment: params.amountCents } },
      });
      await tx.agentStablecoinLedgerEntry.create({
        data: {
          ledgerId: ledger.id,
          type: "CREDIT" satisfies AgentStablecoinLedgerEntryType,
          amountCents: params.amountCents,
          balanceAfterCents: updated.balanceUsdcCents,
          referenceType,
          referenceId,
          note: params.note ?? null,
        },
      });
      return toLedgerBalance(params.agentId, updated);
    });
  } catch (error) {
    if (referenceType && referenceId) {
      const existing = await findReferenceEntry(referenceType, referenceId);
      if (existing) {
        assertReferenceReplay(existing, {
          agentId: params.agentId,
          type: "CREDIT",
          amountCents: params.amountCents,
        });
        return getAgentLedgerBalance(params.agentId);
      }
    }
    throw error;
  }
}

/** Move USDC from the account treasury wallet into an agent's stablecoin spend ledger. */
export async function transferTreasuryToAgentLedger(params: {
  appAccountId: string;
  agentId: number;
  amountCents: number;
  idempotencyKey?: string;
}): Promise<{ ledger: AgentLedgerBalance; treasuryBalanceAfterCents: number }> {
  positiveSafeCents(params.amountCents, "Transfer amount");
  const treasuryExpectation: TreasuryIdempotencyExpectation = {
    appAccountId: params.appAccountId,
    type: "WITHDRAWAL",
    amountCents: params.amountCents,
    agentId: params.agentId,
    reason: "agent_ledger_fund",
  };
  if (params.idempotencyKey) {
    const existing = await loadTreasuryIdempotencyReplay(params.idempotencyKey, treasuryExpectation);
    if (existing) {
      return {
        ledger: await getAgentLedgerBalance(params.agentId),
        treasuryBalanceAfterCents: existing.transaction.balanceAfterCents ?? existing.wallet.balanceUsdcCents,
      };
    }
  }

  const [agent, wallet] = await Promise.all([
    prisma.agent.findFirst({
      where: { id: params.agentId, ownerAccountId: params.appAccountId, isActive: true },
      select: { id: true },
    }),
    ensureTreasuryWallet(params.appAccountId),
  ]);
  if (!agent) throw new Error("Select an active agent owned by this account");

  try {
    return await prisma.$transaction(async (tx) => {
      const updatedWallet = await debitTreasuryAvailableInTx(tx, wallet.id, params.amountCents);
      if (!updatedWallet) throw new Error("Insufficient USDC treasury balance");

      const treasuryTransaction = await tx.treasuryTransaction.create({
        data: {
          appAccountId: params.appAccountId,
          walletId: wallet.id,
          agentId: params.agentId,
          type: "WITHDRAWAL",
          amountCents: params.amountCents,
          currency: "USDC",
          status: "SETTLED",
          reason: "agent_ledger_fund",
          idempotencyKey: params.idempotencyKey ?? null,
          balanceAfterCents: updatedWallet.balanceUsdcCents,
        },
      });

      const ledger = await tx.agentStablecoinLedger.upsert({
        where: { agentId: params.agentId },
        create: { agentId: params.agentId },
        update: {},
      });
      const updatedLedger = await tx.agentStablecoinLedger.update({
        where: { id: ledger.id },
        data: { balanceUsdcCents: { increment: params.amountCents } },
      });
      await tx.agentStablecoinLedgerEntry.create({
        data: {
          ledgerId: ledger.id,
          type: "CREDIT" satisfies AgentStablecoinLedgerEntryType,
          amountCents: params.amountCents,
          balanceAfterCents: updatedLedger.balanceUsdcCents,
          referenceType: "treasury_transfer",
          referenceId: treasuryTransaction.id,
          note: "USDC moved from treasury to agent spend ledger",
        },
      });

      return {
        ledger: toLedgerBalance(params.agentId, updatedLedger),
        treasuryBalanceAfterCents: updatedWallet.balanceUsdcCents,
      };
    });
  } catch (error) {
    if (params.idempotencyKey) {
      const existing = await loadTreasuryIdempotencyReplay(params.idempotencyKey, treasuryExpectation);
      if (existing) {
        return {
          ledger: await getAgentLedgerBalance(params.agentId),
          treasuryBalanceAfterCents: existing.transaction.balanceAfterCents ?? existing.wallet.balanceUsdcCents,
        };
      }
    }
    throw error;
  }
}

async function debitProviderAuthorization(params: {
  agentId: number;
  amountCents: number;
  referenceType: string;
  referenceId: string;
  note: string;
  insufficientMessage: string;
}): Promise<{ debited: boolean; balanceAfterCents: number }> {
  positiveSafeCents(params.amountCents, "debit amount");
  const referenceType = params.referenceType.trim();
  const referenceId = params.referenceId.trim();
  if (!referenceType || !referenceId) throw new Error("Provider ledger reference is required");
  const existing = await findReferenceEntry(referenceType, referenceId);
  if (existing) {
    assertReferenceReplay(existing, {
      agentId: params.agentId,
      type: "DEBIT",
      amountCents: params.amountCents,
    });
    return { debited: false, balanceAfterCents: existing.balanceAfterCents };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const ledger = await tx.agentStablecoinLedger.upsert({
        where: { agentId: params.agentId },
        create: { agentId: params.agentId },
        update: {},
      });
      const updated = await debitAgentLedgerAvailableInTx(tx, ledger.id, params.amountCents);
      if (!updated) throw new Error(params.insufficientMessage);
      await tx.agentStablecoinLedgerEntry.create({
        data: {
          ledgerId: ledger.id,
          type: "DEBIT" satisfies AgentStablecoinLedgerEntryType,
          amountCents: params.amountCents,
          balanceAfterCents: updated.balanceUsdcCents,
          referenceType,
          referenceId,
          note: params.note,
        },
      });
      return { debited: true, balanceAfterCents: updated.balanceUsdcCents };
    });
  } catch (error) {
    // A duplicate authorization may wait for the winner's balance update and
    // then observe insufficient funds before reaching the unique entry insert.
    const replay = await findReferenceEntry(referenceType, referenceId);
    if (replay) {
      assertReferenceReplay(replay, {
        agentId: params.agentId,
        type: "DEBIT",
        amountCents: params.amountCents,
      });
      return { debited: false, balanceAfterCents: replay.balanceAfterCents };
    }
    throw error;
  }
}

export function debitAgentLedgerForLithicAuthorization(params: {
  agentId: number;
  amountCents: number;
  lithicAuthorizationToken: string;
  note?: string;
}) {
  return debitProviderAuthorization({
    agentId: params.agentId,
    amountCents: params.amountCents,
    referenceType: LITHIC_AUTH_REFERENCE,
    referenceId: params.lithicAuthorizationToken,
    note: params.note ?? "Lithic ASA authorization",
    insufficientMessage: "Insufficient stablecoin balance for Lithic authorization debit",
  });
}

export function debitAgentLedgerForMarqetaJit(params: {
  agentId: number;
  amountCents: number;
  marqetaJitFundingToken: string;
  note?: string;
}) {
  return debitProviderAuthorization({
    agentId: params.agentId,
    amountCents: params.amountCents,
    referenceType: MARQETA_JIT_AUTH_REFERENCE,
    referenceId: params.marqetaJitFundingToken,
    note: params.note ?? "Marqeta JIT authorization",
    insufficientMessage: "Insufficient stablecoin balance for Marqeta JIT authorization debit",
  });
}

async function creditProviderRefund(params: {
  agentId: number;
  amountCents: number;
  referenceType: string;
  referenceId: string;
  note: string;
}): Promise<{ credited: boolean; balanceAfterCents: number }> {
  if (!Number.isSafeInteger(params.amountCents) || params.amountCents > MAX_MONEY_CENTS) {
    throw new Error(`refund amount must be an integer no greater than ${MAX_MONEY_CENTS}`);
  }
  const referenceType = params.referenceType.trim();
  const referenceId = params.referenceId.trim();
  if (!referenceType || !referenceId) throw new Error("Provider ledger reference is required");
  const existing = await findReferenceEntry(referenceType, referenceId);
  if (existing) {
    assertReferenceReplay(existing, {
      agentId: params.agentId,
      type: "CREDIT",
      amountCents: params.amountCents,
    });
    return { credited: false, balanceAfterCents: existing.balanceAfterCents };
  }
  if (params.amountCents <= 0) {
    const balance = await getAgentLedgerBalance(params.agentId);
    return { credited: false, balanceAfterCents: balance.balanceUsdcCents };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const ledger = await tx.agentStablecoinLedger.upsert({
        where: { agentId: params.agentId },
        create: { agentId: params.agentId },
        update: {},
      });
      const updated = await tx.agentStablecoinLedger.update({
        where: { id: ledger.id },
        data: { balanceUsdcCents: { increment: params.amountCents } },
      });
      await tx.agentStablecoinLedgerEntry.create({
        data: {
          ledgerId: ledger.id,
          type: "CREDIT" satisfies AgentStablecoinLedgerEntryType,
          amountCents: params.amountCents,
          balanceAfterCents: updated.balanceUsdcCents,
          referenceType,
          referenceId,
          note: params.note,
        },
      });
      return { credited: true, balanceAfterCents: updated.balanceUsdcCents };
    });
  } catch (error) {
    const replay = await findReferenceEntry(referenceType, referenceId);
    if (replay) {
      assertReferenceReplay(replay, {
        agentId: params.agentId,
        type: "CREDIT",
        amountCents: params.amountCents,
      });
      return { credited: false, balanceAfterCents: replay.balanceAfterCents };
    }
    throw error;
  }
}

export function creditAgentLedgerForMarqetaJitRefund(params: {
  agentId: number;
  amountCents: number;
  marqetaJitFundingToken: string;
  note?: string;
}) {
  return creditProviderRefund({
    agentId: params.agentId,
    amountCents: params.amountCents,
    referenceType: MARQETA_JIT_REFUND_REFERENCE,
    referenceId: params.marqetaJitFundingToken,
    note: params.note ?? "Marqeta JIT refund/credit",
  });
}

export function creditAgentLedgerForMarqetaEventRefund(params: {
  agentId: number;
  amountCents: number;
  marqetaTransactionToken: string;
  note?: string;
}) {
  return creditProviderRefund({
    agentId: params.agentId,
    amountCents: params.amountCents,
    referenceType: MARQETA_EVENT_REFUND_REFERENCE,
    referenceId: params.marqetaTransactionToken,
    note: params.note ?? "Marqeta transaction reversal/refund",
  });
}
