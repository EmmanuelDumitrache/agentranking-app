import "server-only";
import { VersionedTransaction } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { getAgentLaunchConnection } from "@/lib/agent-launch/solana";
import { loadAgentCustodialKeypair } from "@/lib/custodial-wallet/sign-launch";
import { logCustodialWalletAudit } from "@/lib/custodial-wallet/audit";
import { invalidateWalletBalanceCache } from "@/features/agent-chat/server/tools/wallet-balance";
import { getAgentTradingConfig } from "@/lib/agent-trading/config";
import { WSOL_MINT, type TradeSide } from "@/lib/agent-trading/constants";
import {
  getJupiterQuote,
  getJupiterSwapTransaction,
  getJupiterTokenInfo,
  type JupiterQuote,
  type JupiterTokenInfo,
} from "@/lib/agent-trading/jupiter-client";
import { loadSplTokenBalanceRaw } from "@/lib/agent-trading/spl-balance";
import { loadAgentWalletSolBalanceLamports } from "@/lib/dashboard/agent-overview";
import { resolveAgentWallet } from "@/lib/custodial-wallet/agent-wallet-resolve";

const LAMPORTS_PER_SOL = 1_000_000_000n;

export type TradeQuoteInput = {
  agentDbId: number;
  side: TradeSide;
  tokenMint: string;
  amount: string;
  amountKind: "sol" | "token" | "percent";
  slippageBps?: number;
};

export type TradeQuoteResult =
  | {
      ok: true;
      side: TradeSide;
      tokenMint: string;
      token: JupiterTokenInfo | null;
      inputMint: string;
      outputMint: string;
      inputAmount: string;
      outputAmount: string;
      slippageBps: number;
      priceImpactPct: string;
      quote: JupiterQuote;
      walletPublicKey: string;
      solBalanceLamports: number | null;
      tokenBalanceRaw: string | null;
    }
  | { ok: false; code: string; message: string };

export type ExecuteTradeInput = {
  agentDbId: number;
  actorProfileId?: number;
  side: TradeSide;
  tokenMint: string;
  quote: JupiterQuote;
  tokenSymbol?: string | null;
  tokenName?: string | null;
};

export type ExecuteTradeResult =
  | { ok: true; signature: string; tradeId: string }
  | { ok: false; code: string; message: string };

function parseAgent(agentDbId: number) {
  return prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      owner: true,
      listingRegistrySource: true,
      chainId: true,
      agentWalletId: true,
      agentWallet: { select: { id: true, publicKey: true } },
    },
  });
}

async function resolveWalletPublicKey(agentDbId: number): Promise<string | null> {
  const agent = await parseAgent(agentDbId);
  if (!agent) return null;
  const metadataRow = await prisma.agentMetadata.findFirst({
    where: { agentId: agentDbId, key: "agentWallet" },
    select: { value: true },
  });
  const resolved = await resolveAgentWallet(agentDbId, {
    owner: agent.owner,
    listingRegistrySource: agent.listingRegistrySource ?? "",
    chainId: agent.chainId,
    metadataWallet: metadataRow?.value ?? null,
  });
  return resolved?.isCustodial ? resolved.publicKey : null;
}

function toRawAmount(amount: number, decimals: number): bigint {
  const factor = 10 ** decimals;
  return BigInt(Math.floor(amount * factor));
}

function percentOfBalance(balance: bigint, percent: number): bigint {
  if (percent <= 0 || percent > 100) return BigInt(0);
  return (balance * BigInt(Math.floor(percent * 100))) / BigInt(10_000);
}

export async function buildAgentTradeQuote(
  input: TradeQuoteInput,
): Promise<TradeQuoteResult> {
  const tokenMint = input.tokenMint.trim();
  if (!tokenMint) {
    return { ok: false, code: "invalid_mint", message: "Token mint is required." };
  }

  const walletPublicKey = await resolveWalletPublicKey(input.agentDbId);
  if (!walletPublicKey) {
    return {
      ok: false,
      code: "wallet_unavailable",
      message: "Agent custodial wallet is not available.",
    };
  }

  const config = getAgentTradingConfig();
  const slippageBps = input.slippageBps ?? config.defaultSlippageBps;
  const tokenInfo = await getJupiterTokenInfo(tokenMint);
  const [solBalanceLamports, tokenBalanceRaw] = await Promise.all([
    loadAgentWalletSolBalanceLamports(walletPublicKey),
    loadSplTokenBalanceRaw(tokenMint, walletPublicKey),
  ]);

  const decimals = tokenInfo?.decimals ?? 6;
  let rawAmount: bigint;
  if (input.side === "buy") {
    if (input.amountKind === "sol") {
      const sol = Number.parseFloat(input.amount);
      if (!Number.isFinite(sol) || sol <= 0) {
        return { ok: false, code: "invalid_amount", message: "Enter a valid SOL amount." };
      }
      rawAmount = BigInt(Math.floor(sol * Number(LAMPORTS_PER_SOL)));
    } else {
      return {
        ok: false,
        code: "invalid_amount_kind",
        message: "Buy orders must specify a SOL amount.",
      };
    }
    if (solBalanceLamports != null && rawAmount > BigInt(solBalanceLamports)) {
      return {
        ok: false,
        code: "insufficient_balance",
        message: "Insufficient SOL balance for the requested buy amount.",
      };
    }
  } else {
    const balance = tokenBalanceRaw ?? BigInt(0);
    if (input.amountKind === "percent") {
      const pct = Number.parseFloat(input.amount);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        return { ok: false, code: "invalid_amount", message: "Enter a valid percentage." };
      }
      rawAmount = percentOfBalance(balance, pct);
    } else if (input.amountKind === "token") {
      const tokenAmount = Number.parseFloat(input.amount);
      if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
        return { ok: false, code: "invalid_amount", message: "Enter a valid token amount." };
      }
      rawAmount = toRawAmount(tokenAmount, decimals);
    } else {
      return {
        ok: false,
        code: "invalid_amount_kind",
        message: "Sell orders must specify token amount or percentage.",
      };
    }
    if (rawAmount <= BigInt(0) || rawAmount > balance) {
      return {
        ok: false,
        code: "insufficient_balance",
        message: "Insufficient token balance.",
      };
    }
  }

  const inputMint = input.side === "buy" ? WSOL_MINT : tokenMint;
  const outputMint = input.side === "buy" ? tokenMint : WSOL_MINT;

  let quote: JupiterQuote;
  try {
    quote = await getJupiterQuote({
      inputMint,
      outputMint,
      amount: rawAmount.toString(),
      slippageBps,
      platformFeeBps: config.platformFeeBps > 0 ? config.platformFeeBps : undefined,
    });
  } catch (error) {
    return {
      ok: false,
      code: "quote_failed",
      message: error instanceof Error ? error.message : "Failed to fetch quote.",
    };
  }

  return {
    ok: true,
    side: input.side,
    tokenMint,
    token: tokenInfo,
    inputMint,
    outputMint,
    inputAmount: quote.inAmount,
    outputAmount: quote.outAmount,
    slippageBps,
    priceImpactPct: quote.priceImpactPct,
    quote,
    walletPublicKey,
    solBalanceLamports,
    tokenBalanceRaw: tokenBalanceRaw?.toString() ?? null,
  };
}

export async function executeAgentTrade(
  input: ExecuteTradeInput,
): Promise<ExecuteTradeResult> {
  const agent = await parseAgent(input.agentDbId);
  if (!agent?.agentWallet?.publicKey || !agent.agentWalletId) {
    return {
      ok: false,
      code: "wallet_unavailable",
      message: "Agent custodial wallet is not available.",
    };
  }

  const keypair = await loadAgentCustodialKeypair(input.agentDbId);
  if (!keypair) {
    return {
      ok: false,
      code: "wallet_unavailable",
      message: "Unable to load agent signing key.",
    };
  }

  const trade = await prisma.agentTrade.create({
    data: {
      agentDbId: input.agentDbId,
      side: input.side,
      inputMint: input.quote.inputMint,
      outputMint: input.quote.outputMint,
      inputAmount: input.quote.inAmount,
      outputAmount: input.quote.outAmount,
      slippageBps: input.quote.slippageBps,
      priceImpactPct: input.quote.priceImpactPct,
      tokenSymbol: input.tokenSymbol ?? null,
      tokenName: input.tokenName ?? null,
      status: "pending",
    },
  });

  try {
    const swap = await getJupiterSwapTransaction({
      quote: input.quote,
      userPublicKey: agent.agentWallet.publicKey,
    });

    const transaction = VersionedTransaction.deserialize(
      Buffer.from(swap.swapTransaction, "base64"),
    );
    transaction.sign([keypair]);

    const connection = getAgentLaunchConnection();
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    const confirmation = await connection.confirmTransaction(signature, "confirmed");

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    await prisma.agentTrade.update({
      where: { id: trade.id },
      data: {
        signature,
        status: "confirmed",
        confirmedAt: new Date(),
      },
    });

    await logCustodialWalletAudit(agent.agentWalletId, "trade.swap.confirmed", {
      actorProfileId: input.actorProfileId,
      metadata: {
        tradeId: trade.id,
        side: input.side,
        tokenMint: input.tokenMint,
        signature,
        inputMint: input.quote.inputMint,
        outputMint: input.quote.outputMint,
        inputAmount: input.quote.inAmount,
        outputAmount: input.quote.outAmount,
      },
    });

    await invalidateWalletBalanceCache(input.agentDbId);

    return { ok: true, signature, tradeId: trade.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Swap failed.";
    await prisma.agentTrade.update({
      where: { id: trade.id },
      data: { status: "failed", error: message },
    });
    await logCustodialWalletAudit(agent.agentWalletId, "trade.swap.failed", {
      actorProfileId: input.actorProfileId,
      metadata: {
        tradeId: trade.id,
        side: input.side,
        tokenMint: input.tokenMint,
        error: message,
      },
    });
    return { ok: false, code: "swap_failed", message };
  }
}
