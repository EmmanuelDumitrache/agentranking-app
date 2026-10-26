import type {
  ConfirmFundingParams,
  ConfirmFundingResult,
  CreateFundingIntentParams,
  FundingIntentResult,
  PaymentProvider,
} from "../types";
import {
  kripicardCreateDeposit,
  kripicardDepositStatus,
} from "@/lib/agent-payments/providers/card/kripicard-api";
import { getKripicardConfig } from "@/lib/agent-payments/providers/card/kripicard-config";

/**
 * Treasury funding via Kripicard crypto deposits (USDT/BTC/ETH).
 */
export class KripicardFundingProvider implements PaymentProvider {
  readonly name = "kripicard";

  async createFundingIntent(params: CreateFundingIntentParams): Promise<FundingIntentResult> {
    const config = getKripicardConfig();
    if (!config.configured) {
      throw new Error("Kripicard funding is not configured — set KRIPICARD_API_KEY.");
    }

    const amountUsd = Math.max(10, Math.round(params.amountCents / 100));
    const created = await kripicardCreateDeposit({
      amountUsd,
      currency: config.defaultCurrency,
      network: config.defaultNetwork,
      orderId: params.idempotencyKey,
    });

    const data = created.data;
    if (!data?.id) {
      throw new Error("Kripicard deposit did not return an id");
    }

    return {
      providerIntentId: data.id,
      checkoutUrl: null,
      status: "pending",
      expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
      providerMetadata: {
        payAddress: data.pay_address,
        payAmount: data.pay_amount,
        payCurrency: data.pay_currency,
        network: data.network,
        amountUsd: data.amount_usd,
        feeUsd: data.fee_usd,
        creditedOnCompletionUsd: data.credited_on_completion_usd,
      },
    };
  }

  async confirmFunding(params: ConfirmFundingParams): Promise<ConfirmFundingResult> {
    const status = await kripicardDepositStatus(params.providerIntentId);
    const data = status.data;
    if (!data) {
      return { confirmed: false, amountCents: 0, providerTransactionId: null };
    }

    if (data.status === "failed") {
      return { confirmed: false, amountCents: 0, providerTransactionId: data.id };
    }

    if (data.status !== "completed" || !data.credited) {
      return { confirmed: false, amountCents: 0, providerTransactionId: data.id };
    }

    return {
      confirmed: true,
      amountCents: Math.round(data.credited_amount_usd * 100),
      providerTransactionId: data.id,
    };
  }
}
