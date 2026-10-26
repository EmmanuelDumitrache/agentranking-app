import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPaymentProvider } from "../providers";
import { writeAuditLog } from "./audit-service";
import { deposit, ensureTreasuryWallet } from "./wallet-service";

const MAX_MONEY_CENTS = 2_147_483_647;
const FUNDING_CLAIM_WAIT_MS = 5_000;
const FUNDING_CLAIM_POLL_MS = 50;

function assertFundingIntentReplayMatches(
  intent: {
    appAccountId: string;
    amountCents: number;
    currency: string;
  },
  expected: { appAccountId: string; amountCents: number },
): void {
  if (
    intent.appAccountId !== expected.appAccountId ||
    intent.amountCents !== expected.amountCents ||
    intent.currency !== "USDC"
  ) {
    throw new Error("Idempotency key is already in use for a different funding intent");
  }
}

async function waitForFundingIntentClaim(
  id: string,
  expected: { appAccountId: string; amountCents: number },
) {
  const deadline = Date.now() + FUNDING_CLAIM_WAIT_MS;
  let intent = await prisma.treasuryFundingIntent.findUniqueOrThrow({ where: { id } });
  assertFundingIntentReplayMatches(intent, expected);
  while (
    intent.status === "CREATED" &&
    !intent.providerIntentId &&
    Date.now() < deadline
  ) {
    await delay(FUNDING_CLAIM_POLL_MS);
    intent = await prisma.treasuryFundingIntent.findUniqueOrThrow({ where: { id } });
    assertFundingIntentReplayMatches(intent, expected);
  }
  return intent;
}

export async function createFundingIntent(params: {
  appAccountId: string;
  amountCents: number;
  returnUrl: string;
  idempotencyKey?: string;
}) {
  if (
    !Number.isSafeInteger(params.amountCents) ||
    params.amountCents < 1000 ||
    params.amountCents > MAX_MONEY_CENTS
  ) {
    throw new Error(`Funding amount must be an integer between 1000 and ${MAX_MONEY_CENTS} cents`);
  }

  const idempotencyKey = params.idempotencyKey?.trim() || randomUUID();
  const replayExpectation = {
    appAccountId: params.appAccountId,
    amountCents: params.amountCents,
  };

  const existing = await prisma.treasuryFundingIntent.findUnique({ where: { idempotencyKey } });
  if (existing) {
    assertFundingIntentReplayMatches(existing, replayExpectation);
    return waitForFundingIntentClaim(existing.id, replayExpectation);
  }

  const provider = getPaymentProvider();
  const wallet = await ensureTreasuryWallet(params.appAccountId);

  const claim = await (async () => {
    try {
      const intent = await prisma.treasuryFundingIntent.create({
        data: {
          appAccountId: params.appAccountId,
          walletId: wallet.id,
          amountCents: params.amountCents,
          currency: "USDC",
          status: "CREATED",
          providerName: provider.name,
          idempotencyKey,
        },
      });
      return { intent, owner: true as const };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const intent = await prisma.treasuryFundingIntent.findUniqueOrThrow({ where: { idempotencyKey } });
      assertFundingIntentReplayMatches(intent, replayExpectation);
      return { intent, owner: false as const };
    }
  })();

  // Only the caller that inserted the unique idempotency claim may invoke the
  // external provider. Concurrent callers wait briefly for that owner to
  // publish the provider id/checkout details rather than receiving an
  // unusable half-created row.
  if (!claim.owner) return waitForFundingIntentClaim(claim.intent.id, replayExpectation);
  const claimed = claim.intent;

  try {
    const result = await provider.createFundingIntent({
      appAccountId: params.appAccountId,
      amountCents: params.amountCents,
      currency: "USDC",
      idempotencyKey,
      returnUrl: params.returnUrl,
    });

    const intent = await prisma.treasuryFundingIntent.update({
      where: { id: claimed.id },
      data: {
        status: result.status === "pending" ? "PENDING" : "CREATED",
        providerIntentId: result.providerIntentId,
        checkoutUrl: result.checkoutUrl,
        expiresAt: result.expiresAt ?? null,
        metadata: result.providerMetadata
          ? JSON.parse(JSON.stringify(result.providerMetadata))
          : undefined,
      },
    });

    await writeAuditLog({
      appAccountId: params.appAccountId,
      action: "funding.intent_created",
      entityType: "funding_intent",
      entityId: intent.id,
      metadata: { amountCents: params.amountCents, provider: provider.name },
    });
    return intent;
  } catch (error) {
    await prisma.treasuryFundingIntent.update({
      where: { id: claimed.id },
      data: { status: "FAILED" },
    }).catch(() => undefined);
    throw error;
  }
}

export async function confirmFunding(params: {
  appAccountId: string;
  intentId: string;
}) {
  const intent = await prisma.treasuryFundingIntent.findFirst({
    where: { id: params.intentId, appAccountId: params.appAccountId },
  });
  if (!intent) throw new Error("Funding intent not found");
  if (intent.status === "CONFIRMED") return intent;
  if (!intent.providerIntentId) throw new Error("Missing provider intent id");

  if (intent.providerName === "kripicard") {
    const provider = getPaymentProvider();
    const confirmation = await provider.confirmFunding({
      providerIntentId: intent.providerIntentId,
    });
    if (!confirmation.confirmed) {
      return prisma.treasuryFundingIntent.findUniqueOrThrow({ where: { id: intent.id } });
    }

    await deposit({
      appAccountId: params.appAccountId,
      amountCents: confirmation.amountCents || intent.amountCents,
      providerTransactionId: confirmation.providerTransactionId,
      idempotencyKey: `funding:${intent.id}`,
      metadata: { fundingIntentId: intent.id },
    });

    const updated = await prisma.treasuryFundingIntent.update({
      where: { id: intent.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });

    await writeAuditLog({
      appAccountId: params.appAccountId,
      action: "funding.confirmed",
      entityType: "funding_intent",
      entityId: intent.id,
      metadata: { amountCents: confirmation.amountCents },
    });

    return updated;
  }

  const provider = getPaymentProvider();
  const confirmation = await provider.confirmFunding({
    providerIntentId: intent.providerIntentId,
  });
  if (!confirmation.confirmed) {
    await prisma.treasuryFundingIntent.update({
      where: { id: intent.id },
      data: { status: "FAILED" },
    });
    throw new Error("Funding not confirmed by provider");
  }

  await deposit({
    appAccountId: params.appAccountId,
    amountCents: confirmation.amountCents || intent.amountCents,
    providerTransactionId: confirmation.providerTransactionId,
    idempotencyKey: `funding:${intent.id}`,
    metadata: { fundingIntentId: intent.id },
  });

  const updated = await prisma.treasuryFundingIntent.update({
    where: { id: intent.id },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });

  await writeAuditLog({
    appAccountId: params.appAccountId,
    action: "funding.confirmed",
    entityType: "funding_intent",
    entityId: intent.id,
    metadata: { amountCents: intent.amountCents },
  });

  return updated;
}

export async function syncBalance(appAccountId: string) {
  const wallet = await ensureTreasuryWallet(appAccountId);
  const provider = getPaymentProvider();
  if (wallet.providerWalletId && provider.syncBalance) {
    const remote = await provider.syncBalance(wallet.providerWalletId);
    return {
      localBalanceUsdcCents: wallet.balanceUsdcCents,
      remoteBalanceUsdcCents: remote.balanceCents,
      walletId: wallet.id,
    };
  }
  return {
    localBalanceUsdcCents: wallet.balanceUsdcCents,
    remoteBalanceUsdcCents: null,
    walletId: wallet.id,
  };
}
