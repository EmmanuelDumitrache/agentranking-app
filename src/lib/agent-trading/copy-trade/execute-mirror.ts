import "server-only";

import { prisma } from "@/lib/db";
import {
  buildAgentTradeQuote,
  executeAgentTrade,
} from "@/lib/agent-trading/execute-trade";
import type { DetectedLeaderTrade } from "@/lib/agent-trading/copy-trade/detect";

export type CopyTradeConfigForMirror = {
  id: string;
  agentDbId: number;
  buyMode: string;
  buyPercent: number;
  buySolAmount: number | null;
  sellPercent: number;
  maxBuySol: number | null;
  portfolioAllocationPct: number;
  lastMirroredSig: string | null;
};

const MIN_MIRROR_BUY_SOL = 0.001;

export type MirrorResult =
  | {
      ok: true;
      skipped?: false;
      tradeId: string;
      signature: string;
      side: "buy" | "sell";
      solAmount?: number;
      sellPercent?: number;
    }
  | {
      ok: true;
      skipped: true;
      reason: string;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

function sizeBuySol(
  config: CopyTradeConfigForMirror,
  leaderSolSpent: number,
): number {
  let sol =
    config.buyMode === "sol" && config.buySolAmount != null && config.buySolAmount > 0
      ? config.buySolAmount
      : leaderSolSpent * (config.buyPercent / 100);

  const allocation = Math.min(100, Math.max(1, config.portfolioAllocationPct || 100));
  if (allocation < 100) {
    sol *= allocation / 100;
  }

  if (config.maxBuySol != null && config.maxBuySol > 0 && sol > config.maxBuySol) {
    sol = config.maxBuySol;
  }

  return sol;
}

/**
 * Mirror one detected leader trade onto an agent's custodial wallet via Jupiter.
 */
export async function executeCopyTradeMirror(input: {
  config: CopyTradeConfigForMirror;
  trade: DetectedLeaderTrade;
  leaderSignature: string;
}): Promise<MirrorResult> {
  const { config, trade, leaderSignature } = input;

  if (config.lastMirroredSig === leaderSignature) {
    return { ok: true, skipped: true, reason: "already_mirrored_sig" };
  }

  if (trade.type === "buy") {
    const solAmount = sizeBuySol(config, trade.solAmount);
    if (!Number.isFinite(solAmount) || solAmount < MIN_MIRROR_BUY_SOL) {
      return { ok: true, skipped: true, reason: "buy_too_small" };
    }

    const quote = await buildAgentTradeQuote({
      agentDbId: config.agentDbId,
      side: "buy",
      tokenMint: trade.tokenMint,
      amount: String(solAmount),
      amountKind: "sol",
    });
    if (!quote.ok) {
      return { ok: false, code: quote.code, message: quote.message };
    }

    const executed = await executeAgentTrade({
      agentDbId: config.agentDbId,
      side: "buy",
      tokenMint: trade.tokenMint,
      quote: quote.quote,
      tokenSymbol: quote.token?.symbol ?? null,
      tokenName: quote.token?.name ?? null,
    });
    if (!executed.ok) {
      return { ok: false, code: executed.code, message: executed.message };
    }

    await prisma.agentCopyTradeConfig.update({
      where: { id: config.id },
      data: {
        lastMirroredSig: leaderSignature,
        lastMirroredAt: new Date(),
        mirrorCount: { increment: 1 },
      },
    });

    return {
      ok: true,
      tradeId: executed.tradeId,
      signature: executed.signature,
      side: "buy",
      solAmount,
    };
  }

  const sellPercent = trade.isFullSell
    ? 100
    : Math.min(100, Math.max(1, config.sellPercent || 100));

  const quote = await buildAgentTradeQuote({
    agentDbId: config.agentDbId,
    side: "sell",
    tokenMint: trade.tokenMint,
    amount: String(sellPercent),
    amountKind: "percent",
  });
  if (!quote.ok) {
    // No position yet is a normal skip, not a hard failure.
    if (quote.code === "insufficient_balance") {
      return { ok: true, skipped: true, reason: "no_token_balance" };
    }
    return { ok: false, code: quote.code, message: quote.message };
  }

  const executed = await executeAgentTrade({
    agentDbId: config.agentDbId,
    side: "sell",
    tokenMint: trade.tokenMint,
    quote: quote.quote,
    tokenSymbol: quote.token?.symbol ?? null,
    tokenName: quote.token?.name ?? null,
  });
  if (!executed.ok) {
    return { ok: false, code: executed.code, message: executed.message };
  }

  await prisma.agentCopyTradeConfig.update({
    where: { id: config.id },
    data: {
      lastMirroredSig: leaderSignature,
      lastMirroredAt: new Date(),
      mirrorCount: { increment: 1 },
    },
  });

  return {
    ok: true,
    tradeId: executed.tradeId,
    signature: executed.signature,
    side: "sell",
    sellPercent,
  };
}
