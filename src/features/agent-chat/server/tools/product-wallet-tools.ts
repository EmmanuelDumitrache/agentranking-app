import "server-only";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { tool, type ToolSet } from "ai";
import { z } from "zod/v4";
import { sendSolFromAgentWallet } from "@/lib/custodial-wallet/send-sol";
import {
  formatLamportsAsSol,
  parseSolAmountToLamports,
} from "@/lib/custodial-wallet/sol-transfer-policy";
import { getRecentTransfers } from "@/lib/agent-transfers";
import { getWalletBalances, invalidateWalletBalanceCache } from "./wallet-balance";
import { agentToolContextSchema, requireAgentToolContext } from "./context";
import { markToolEffect } from "./tool-effects";
function solscanTxUrl(signature: string, network: string): string {
  const base = `https://solscan.io/tx/${signature}`;
  return network === "devnet" ? `${base}?cluster=devnet` : base;
}
function formatSol(lamports: number | null): string | null {
  if (lamports == null || !Number.isFinite(lamports)) return null;
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}
function formatTokenAmount(
  raw: { amount: string; decimals: number } | null,
): string | null {
  if (!raw) return null;
  const n = Number(raw.amount) / 10 ** raw.decimals;
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, {
    maximumFractionDigits: Math.min(6, raw.decimals),
  });
}
/** AgentRanking-native wallet convenience tools. */
export function buildProductWalletTools(): ToolSet {
  const get_wallet_status = tool({
    description:
      "Show this agent's linked Solana custodial wallet: address, network, SOL / USDC / $AR balances. Use for balance or wallet-status questions.",
    inputSchema: z.object({}),
    contextSchema: agentToolContextSchema,
    execute: async (_input, { context: executionContext }) => {
      const context = requireAgentToolContext(executionContext);
      const balances = await getWalletBalances(context.agentDbId);
      if (!balances.publicKey) {
        return {
          status: "unavailable",
          message: "No Solana wallet is linked to this agent yet.",
        };
      }
      return {
        status: "ok",
        publicKey: balances.publicKey,
        network: balances.network,
        isCustodial: balances.isCustodial,
        sol: formatSol(balances.solBalanceLamports),
        usdc: formatTokenAmount(balances.usdcBalance),
        ar: formatTokenAmount(balances.arBalance),
      };
    },
  });
  const list_recent_transfers = tool({
    description:
      "List recent SOL transfers sent from this agent's custodial wallet (dashboard-audited history).",
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("How many transfers to return (default 5, max 20)"),
    }),
    contextSchema: agentToolContextSchema,
    execute: async (input, { context: executionContext }) => {
      const context = requireAgentToolContext(executionContext);
      const transfers = await getRecentTransfers(
        context.agentDbId,
        input.limit ?? 5,
      );
      return {
        status: "ok",
        count: transfers.length,
        transfers: transfers.map((t) => ({
          token: t.token,
          to: t.toPublicKey,
          amountSol:
            t.token === "SOL"
              ? (Number(t.amountLamports) / LAMPORTS_PER_SOL).toFixed(6)
              : null,
          amountLamports: t.amountLamports,
          status: t.status,
          signature: t.signature,
          createdAt: t.createdAt,
          solscanUrl: t.signature
            ? solscanTxUrl(
                t.signature,
                process.env.AGENT_LAUNCH_NETWORK === "devnet"
                  ? "devnet"
                  : "mainnet",
              )
            : null,
        })),
      };
    },
  });
  const send_sol = markToolEffect(tool({
    description:
      "Send any positive SOL amount from this agent's custodial Solana wallet to a recipient address. The transfer succeeds when the wallet can sign and has enough SOL for the amount plus the network fee.",
    inputSchema: z.object({
      recipient: z
        .string()
        .min(32)
        .max(64)
        .describe("Recipient Solana base58 address"),
      amountSol: z
        .number()
        .positive()
        .describe("Amount of SOL to send"),
    }),
    contextSchema: agentToolContextSchema,
    execute: async (input, { context: executionContext }) => {
      const context = requireAgentToolContext(executionContext);
      const amountLamports = parseSolAmountToLamports(input.amountSol);
      if (!amountLamports) {
        return {
          status: "invalid_amount",
          message: "Amount must be greater than 0 and use at most 9 decimal places.",
        };
      }
      const result = await sendSolFromAgentWallet({
        agentDbId: context.agentDbId,
        recipient: input.recipient,
        amountLamports,
      });
      if (result.status === "sent") {
        await invalidateWalletBalanceCache(context.agentDbId);
        const network =
          process.env.AGENT_LAUNCH_NETWORK === "devnet" ? "devnet" : "mainnet";
        return {
          status: "sent",
          signature: result.signature,
          recipient: result.recipient,
          amountSol: formatLamportsAsSol(result.amountLamports),
          network: result.network,
          solscanUrl: solscanTxUrl(result.signature, network),
          message: "SOL transfer confirmed on-chain.",
        };
      }
      return {
        status: result.status,
        message: result.message,
      };
    },
  }), { stateChanging: true });
  return {
    get_wallet_status,
    list_recent_transfers,
    send_sol,
  };
}
