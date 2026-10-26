import type {
  ConfirmFundingParams,
  ConfirmFundingResult,
  CreateFundingIntentParams,
  FundingIntentResult,
  PaymentProvider,
} from "../types";

/**
 * Demo funding provider. Instantly confirms on confirmFunding().
 * Replace via FUNDING_PROVIDER env — never call Stripe from app code.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  private readonly intents = new Map<
    string,
    { amountCents: number; status: "created" | "pending" | "confirmed" | "failed" }
  >();

  async createFundingIntent(
    params: CreateFundingIntentParams,
  ): Promise<FundingIntentResult> {
    const providerIntentId = `mock_fund_${params.idempotencyKey}`;
    this.intents.set(providerIntentId, {
      amountCents: params.amountCents,
      status: "pending",
    });
    const url = new URL(params.returnUrl);
    url.searchParams.set("fundingIntent", providerIntentId);
    url.searchParams.set("provider", this.name);
    return {
      providerIntentId,
      checkoutUrl: url.toString(),
      status: "pending",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  }

  async confirmFunding(params: ConfirmFundingParams): Promise<ConfirmFundingResult> {
    const intent = this.intents.get(params.providerIntentId);
    if (!intent) {
      return { confirmed: false, amountCents: 0, providerTransactionId: null };
    }
    intent.status = "confirmed";
    return {
      confirmed: true,
      amountCents: intent.amountCents,
      providerTransactionId: `mock_tx_${params.providerIntentId}`,
    };
  }
}
