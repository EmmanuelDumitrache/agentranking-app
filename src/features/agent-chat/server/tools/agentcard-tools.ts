import "server-only";

import { tool, type ToolSet } from "ai";
import { z } from "zod/v4";
import {
  AgentCardApiError,
  cancelAgentCardSpendRequest,
  createAgentCardSpendRequest,
  getAgentCardPurchase,
  getAgentCardReadiness,
  getAgentCardSpendRequest,
  getAgentCardWalletBalance,
  isAgentCardConfigured,
  validateAgentCardAmountDollars,
} from "@/lib/agent-trading/agentcard";
import { redactSensitiveText } from "@/lib/security/sensitive-data-redaction";
import { agentToolContextSchema, requireAgentToolContext } from "./context";
import { markToolEffect } from "./tool-effects";

function formatAgentCardError(error: unknown): {
  status: "error";
  message: string;
  code?: string;
} {
  if (error instanceof AgentCardApiError) {
    const body =
      error.body && typeof error.body === "object"
        ? (error.body as Record<string, unknown>)
        : null;
    const code =
      error.code ??
      (typeof body?.code === "string" ? body.code : undefined);
    if (code === "identity_verification_required") {
      return {
        status: "error",
        code,
        message:
          "KYC verification is required before issuing cards. Complete it from the authenticated AgentCard dashboard panel.",
      };
    }
    return {
      status: "error",
      code,
      message: redactSensitiveText(error.message),
    };
  }
  return {
    status: "error",
    message: error instanceof Error
      ? redactSensitiveText(error.message)
      : "AgentCard request failed",
  };
}

function safeReadiness(
  readiness: Awaited<ReturnType<typeof getAgentCardReadiness>>,
) {
  return {
    configured: readiness.configured,
    signedIn: readiness.signedIn,
    paymentMethodReady: readiness.paymentMethodReady,
    agentEmailReady: readiness.agentEmailReady,
    walletReady: readiness.walletReady,
    identityStatus: readiness.identityStatus,
    identityRequired: readiness.identityRequired,
    spendReady: readiness.spendReady,
    limits: readiness.limits,
    messages: readiness.messages,
  };
}

function summarizePurchase(purchase: {
  id: string;
  kind: string;
  amountCents: number;
  status: string;
  sourceStatus?: string;
  createdAt: string;
  expiresAt: string;
  last4?: string | null;
  merchant?: { name: string; url?: string } | null;
  item?: string | null;
}) {
  return {
    id: purchase.id,
    kind: purchase.kind,
    amountDollars: purchase.amountCents / 100,
    status: purchase.status,
    sourceStatus: purchase.sourceStatus,
    createdAt: purchase.createdAt,
    expiresAt: purchase.expiresAt,
    last4: purchase.last4 ?? null,
    merchant: purchase.merchant?.name ?? null,
    item: purchase.item ?? null,
  };
}

function formatIssuedCardResponse(
  req: Awaited<ReturnType<typeof getAgentCardSpendRequest>>,
) {
  return {
    status: "ok" as const,
    sensitive: false,
    id: req.id,
    amountDollars: req.amountCents / 100,
    cardStatus: req.status,
    expiresAt: req.expiresAt,
    last4: req.last4 ?? null,
    message:
      req.status === "issued" || req.status === "ready"
        ? "Card is live. Reveal PAN/CVV only in the authenticated AgentCard panel; credentials are never sent through the model tool channel."
        : "Card request metadata loaded. Sensitive credentials are available only in the authenticated AgentCard panel while the card is live.",
  };
}

/**
 * Operator-funded AgentCard tools (single-use issued cards).
 * Requires AGENTCARD_API_TOKEN from the platform operator account.
 */
export function buildAgentCardTools(): ToolSet {
  const agentcard_status = tool({
    description:
      "Check AgentCard readiness: payment method, KYC, spend limits, and whether single-use cards can be issued.",
    inputSchema: z.object({}),
    contextSchema: agentToolContextSchema,
    execute: async (_input, { context }) => {
      requireAgentToolContext(context);
      if (!isAgentCardConfigured()) {
        return {
          status: "unavailable",
          message:
            "AgentCard is not configured. Set AGENTCARD_API_TOKEN on the server.",
        };
      }
      try {
        const readiness = await getAgentCardReadiness();
        return {
          status: "ok",
          ...safeReadiness(readiness),
          limits: readiness.limits
            ? {
                spendLimitDollars: readiness.limits.spendLimitCents / 100,
                spentDollars: readiness.limits.spentCents / 100,
                remainingDollars: readiness.limits.remainingCents / 100,
              }
            : null,
        };
      } catch (error) {
        return formatAgentCardError(error);
      }
    },
  });

  const agentcard_request_card = markToolEffect(tool({
    description:
      "Issue a single-use virtual card via AgentCard for an online purchase. Returns non-sensitive request metadata only; reveal credentials in the authenticated AgentCard panel.",
    inputSchema: z.object({
      amount_dollars: z
        .number()
        .positive()
        .describe("Hold amount in USD (rounded up to whole dollars)"),
      memo: z
        .string()
        .max(200)
        .optional()
        .describe("Optional note for the operator (not sent to AgentCard)"),
    }),
    contextSchema: agentToolContextSchema,
    execute: async (input, { context: executionContext }) => {
      requireAgentToolContext(executionContext);
      if (!isAgentCardConfigured()) {
        return {
          status: "unavailable",
          message: "AgentCard is not configured.",
        };
      }

      const amountCheck = validateAgentCardAmountDollars(input.amount_dollars);
      if (!amountCheck.ok) {
        return { status: "rejected", message: amountCheck.message };
      }

      try {
        const issued = await createAgentCardSpendRequest(amountCheck.amountCents);
        return {
          ...formatIssuedCardResponse(issued),
          memo: input.memo ?? null,
          holdNote:
            "This places a hold on the operator payment method until the card is used or expires (~7 days). Cancel unused cards to release the hold immediately.",
        };
      } catch (error) {
        return formatAgentCardError(error);
      }
    },
  }), { stateChanging: true });

  const agentcard_get_request = tool({
    description:
      "Get non-sensitive metadata for an AgentCard purchase/request by id. PAN/CVV are never returned through chat tools; reveal them only in the authenticated AgentCard panel.",
    inputSchema: z.object({
      id: z.string().min(1).describe("AgentCard purchase / request id"),
    }),
    contextSchema: agentToolContextSchema,
    execute: async (input, { context }) => {
      requireAgentToolContext(context);
      if (!isAgentCardConfigured()) {
        return { status: "unavailable", message: "AgentCard is not configured." };
      }
      try {
        const purchase = await getAgentCardPurchase(input.id);
        if (purchase.kind !== "issued_card") {
          return {
            status: "ok",
            purchase: summarizePurchase(purchase),
            message: "Connected-card purchases are not supported in v1.",
          };
        }
        const req = await getAgentCardSpendRequest(purchase.id, false);
        return {
          purchase: summarizePurchase(purchase),
          ...formatIssuedCardResponse(req),
        };
      } catch (error) {
        return formatAgentCardError(error);
      }
    },
  });

  const agentcard_cancel_request = markToolEffect(tool({
    description:
      "Cancel an unused issued AgentCard and release the payment hold immediately.",
    inputSchema: z.object({
      id: z.string().min(1).describe("AgentCard purchase / request id"),
    }),
    contextSchema: agentToolContextSchema,
    execute: async (input, { context }) => {
      requireAgentToolContext(context);
      if (!isAgentCardConfigured()) {
        return { status: "unavailable", message: "AgentCard is not configured." };
      }
      try {
        const purchase = await getAgentCardPurchase(input.id);
        if (purchase.kind !== "issued_card") {
          return {
            status: "rejected",
            message: "Only issued single-use cards can be canceled.",
          };
        }
        const canceled = await cancelAgentCardSpendRequest(purchase.id);
        return {
          status: "ok",
          id: canceled.id,
          amountDollars: canceled.amountCents / 100,
          cardStatus: canceled.status,
          message: "Card canceled. Hold released on operator payment method.",
        };
      } catch (error) {
        return formatAgentCardError(error);
      }
    },
  }), { stateChanging: true });

  const agentcard_wallet_balance = tool({
    description:
      "Show the operator AgentCard Base wallet address (USDC balance lookup is best-effort).",
    inputSchema: z.object({}),
    contextSchema: agentToolContextSchema,
    execute: async (_input, { context }) => {
      requireAgentToolContext(context);
      if (!isAgentCardConfigured()) {
        return { status: "unavailable", message: "AgentCard is not configured." };
      }
      try {
        const wallet = await getAgentCardWalletBalance();
        return {
          status: "ok",
          walletAddress: wallet.walletAddress,
          balanceUsdc: wallet.balanceUsdc,
          message: wallet.walletAddress
            ? "Operator AgentCard wallet on Base."
            : "Wallet not provisioned — run `agentcard setup`.",
        };
      } catch (error) {
        return formatAgentCardError(error);
      }
    },
  });

  return {
    agentcard_status,
    agentcard_request_card,
    agentcard_get_request,
    agentcard_cancel_request,
    agentcard_wallet_balance,
  };
}
