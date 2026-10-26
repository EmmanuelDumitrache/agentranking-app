import type { Prisma, LlmCreditDepositAsset } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getSolUsdPrice } from "@/lib/solana-price";
import type { SupportedDepositAsset } from "./types";
import { getDepositConfig } from "./config";
import { getAssetDecimals, getUsdcMint } from "./assets";
import {
  usdCentsToAtomicAmount,
  atomicAmountToUsdCents,
  formatAtomicAmount,
} from "./pricing";
import { generateDepositReference } from "./references";
import { buildSolanaPayTransferUrl } from "./solana-pay";
export async function createDepositIntent(
  tx: Prisma.TransactionClient,
  params: {
    appAccountId: string;
    asset: SupportedDepositAsset;
    requestedUsdCents: number;
    recipientPublicKey: string;
    network: string;
    solUsdPriceMicros?: bigint;
  },
) {
  const { appAccountId, asset, requestedUsdCents, recipientPublicKey, network } =
    params;
  const config = getDepositConfig();
  if (asset !== config.depositAsset) {
    throw new Error(`Asset ${asset} is not enabled for deposits`);
  }
  if (requestedUsdCents < config.minUsdCents) {
    throw new Error(`Minimum deposit is ${config.minUsdCents} cents`);
  }
  let quotedAtomicAmount: bigint;
  let solUsdPriceMicros: bigint | undefined;
  if (asset === "SOL") {
    if (params.solUsdPriceMicros != null) {
      solUsdPriceMicros = params.solUsdPriceMicros;
    } else {
      const price = await getSolUsdPrice();
      if (price == null) {
        throw new Error("SOL price unavailable");
      }
      solUsdPriceMicros = BigInt(Math.round(price * 1_000_000));
    }
    quotedAtomicAmount = usdCentsToAtomicAmount(
      requestedUsdCents,
      "SOL",
      solUsdPriceMicros,
    );
  } else {
    quotedAtomicAmount = usdCentsToAtomicAmount(requestedUsdCents, "USDC");
  }
  const centsAmount = Number(
    atomicAmountToUsdCents(quotedAtomicAmount, asset, solUsdPriceMicros),
  );
  const reference = generateDepositReference();
  const expiresAt = new Date(Date.now() + config.quoteTtlSeconds * 1000);
  const solanaPayUrl = buildSolanaPayTransferUrl({
    recipient: recipientPublicKey,
    amount: formatAtomicAmount(quotedAtomicAmount, asset),
    reference: reference.publicKey,
    label: "AgentRanking",
    message: `LLM deposit (${centsAmount} cents)`,
    splToken: asset === "USDC" ? getUsdcMint(network) : undefined,
  });
  const minAmountAtomic = quotedAtomicAmount;
  return tx.llmCreditDeposit.create({
    data: {
      appAccountId,
      recipientPublicKey,
      network,
      asset,
      mint: asset === "USDC" ? getUsdcMint(network) : null,
      decimals: getAssetDecimals(asset),
      referencePublicKey: reference.publicKey,
      paymentUrl: solanaPayUrl,
      expectedAmountAtomic: quotedAtomicAmount,
      minimumAmountAtomic: minAmountAtomic,
      quotedCents: centsAmount,
      solUsdPriceMicros: solUsdPriceMicros ?? null,
      quoteExpiresAt: expiresAt,
      status: "CREATED",
    },
  });
}
export async function getDepositById(depositId: string) {
  return prisma.llmCreditDeposit.findUnique({
    where: { id: depositId },
  });
}
export async function listDepositsForAccount(
  appAccountId: string,
  limit?: number,
) {
  return prisma.llmCreditDeposit.findMany({
    where: { appAccountId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
export async function findMatchingPendingDeposits(
  tx: Prisma.TransactionClient,
  params: {
    recipientPublicKey: string;
    asset: SupportedDepositAsset;
    receivedAmountAtomic: bigint;
  },
) {
  const config = getDepositConfig();
  const toleranceBps =
    params.asset === "SOL"
      ? config.solOverpayToleranceBps
      : config.usdcOverpayToleranceBps;
  let minExpected: bigint;
  let maxExpected: bigint;
  if (toleranceBps <= 0) {
    // USDC: exact match required
    minExpected = params.receivedAmountAtomic;
    maxExpected = params.receivedAmountAtomic;
  } else {
    // SOL: tolerance. Given received amount R, find expected E such that:
    // E * (10000 - bps) / 10000 <= R <= E * (10000 + bps) / 10000
    // => R * 10000 / (10000 + bps) <= E <= R * 10000 / (10000 - bps)
    const tenThousand = BigInt(10000);
    const denomMin = BigInt(10000 + toleranceBps);
    const denomMax = BigInt(10000 - toleranceBps);
    minExpected = (params.receivedAmountAtomic * tenThousand) / denomMin;
    maxExpected = (params.receivedAmountAtomic * tenThousand) / denomMax;
  }
  return tx.llmCreditDeposit.findMany({
    where: {
      recipientPublicKey: params.recipientPublicKey,
      asset: params.asset as LlmCreditDepositAsset,
      status: { in: ["CREATED", "AWAITING_PAYMENT"] },
      quoteExpiresAt: { gt: new Date() },
      expectedAmountAtomic: {
        gte: minExpected,
        lte: maxExpected,
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
}
export async function expireOldDeposits(): Promise<number> {
  const result = await prisma.llmCreditDeposit.updateMany({
    where: {
      status: { in: ["CREATED", "AWAITING_PAYMENT"] },
      quoteExpiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}
const CANCELLABLE_DEPOSIT_STATUSES = ["CREATED", "AWAITING_PAYMENT"] as const;
export async function cancelDepositForAccount(params: {
  depositId: string;
  appAccountId: string;
}) {
  const deposit = await prisma.llmCreditDeposit.findFirst({
    where: {
      id: params.depositId,
      appAccountId: params.appAccountId,
    },
  });
  if (!deposit) return { ok: false as const, reason: "NOT_FOUND" as const };
  if (
    !CANCELLABLE_DEPOSIT_STATUSES.includes(
      deposit.status as (typeof CANCELLABLE_DEPOSIT_STATUSES)[number],
    )
  ) {
    return { ok: false as const, reason: "NOT_CANCELLABLE" as const, deposit };
  }
  const updated = await prisma.llmCreditDeposit.update({
    where: { id: deposit.id },
    data: {
      status: "CANCELLED",
      failureReason: "Cancelled by user",
    },
  });
  return { ok: true as const, deposit: updated };
}
export async function findMatchingPendingDeposit(
  tx: Prisma.TransactionClient,
  params: {
    recipientPublicKey: string;
    asset: SupportedDepositAsset;
    receivedAmountAtomic: bigint;
  },
) {
  const config = getDepositConfig();
  const toleranceBps =
    params.asset === "SOL"
      ? config.solOverpayToleranceBps
      : config.usdcOverpayToleranceBps;
  let minExpected: bigint;
  let maxExpected: bigint;
  if (toleranceBps <= 0) {
    // USDC: exact match required
    minExpected = params.receivedAmountAtomic;
    maxExpected = params.receivedAmountAtomic;
  } else {
    // SOL: tolerance. Given received amount R, find expected E such that:
    // E * (10000 - bps) / 10000 <= R <= E * (10000 + bps) / 10000
    // => R * 10000 / (10000 + bps) <= E <= R * 10000 / (10000 - bps)
    const tenThousand = BigInt(10000);
    const denomMin = BigInt(10000 + toleranceBps);
    const denomMax = BigInt(10000 - toleranceBps);
    minExpected = (params.receivedAmountAtomic * tenThousand) / denomMin;
    maxExpected = (params.receivedAmountAtomic * tenThousand) / denomMax;
  }
  return tx.llmCreditDeposit.findMany({
    where: {
      recipientPublicKey: params.recipientPublicKey,
      asset: params.asset as LlmCreditDepositAsset,
      status: { in: ["CREATED", "AWAITING_PAYMENT"] },
      quoteExpiresAt: { gt: new Date() },
      expectedAmountAtomic: {
        gte: minExpected,
        lte: maxExpected,
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
}
