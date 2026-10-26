/**
 * Provider-agnostic contracts for Agent Payments.
 * Application code must never import Stripe/Bridge/Rain/Lithic SDKs directly —
 * only through these interfaces and the factory in ./index.ts.
 */

export type FundingCurrency = "USDC";

export interface CreateFundingIntentParams {
  appAccountId: string;
  amountCents: number;
  currency: FundingCurrency;
  idempotencyKey: string;
  returnUrl: string;
  metadata?: Record<string, string>;
}

export interface FundingIntentResult {
  providerIntentId: string;
  checkoutUrl: string | null;
  status: "created" | "pending" | "confirmed" | "failed";
  expiresAt?: Date;
  /** Provider-specific deposit instructions (e.g. Kripicard pay address). */
  providerMetadata?: Record<string, unknown>;
}

export interface ConfirmFundingParams {
  providerIntentId: string;
}

export interface ConfirmFundingResult {
  confirmed: boolean;
  amountCents: number;
  providerTransactionId: string | null;
}

export interface PaymentProvider {
  name: string;
  createFundingIntent(params: CreateFundingIntentParams): Promise<FundingIntentResult>;
  confirmFunding(params: ConfirmFundingParams): Promise<ConfirmFundingResult>;
  syncBalance?(providerWalletId: string): Promise<{ balanceCents: number }>;
}

export interface IssueCardParams {
  appAccountId: string;
  displayName?: string;
  idempotencyKey: string;
}

export interface IssuedCard {
  providerCardId: string;
  lastFour: string;
  brand: string;
  expiryMonth: number | null;
  expiryYear: number | null;
  status: "pending" | "active" | "frozen" | "cancelled";
}

export interface CardDetailsReveal {
  /** Opaque URL or client token for secure reveal — never PAN/CVV in our DB. */
  revealMode: "hosted_url" | "client_token" | "inline" | "unavailable";
  revealUrl?: string;
  clientToken?: string;
  expiresAt?: Date;
  /** Populated only for inline reveal (mock sandbox / AR cards). Never persisted. */
  credentials?: {
    pan: string;
    cvv: string;
    expiryMonth: number;
    expiryYear: number;
    /** Raw expiry from issuer when month/year parsing is unreliable. */
    expiryDisplay?: string;
    cardholderName?: string;
  };
  /** Live prepaid balance from issuer (USD). */
  balanceUsd?: number;
  cardStatus?: IssuedCard["status"];
}

export interface CardIssuerProvider {
  name: string;
  supportsVirtualCards: boolean;
  issueCard(params: IssueCardParams): Promise<IssuedCard>;
  freezeCard(providerCardId: string): Promise<{ ok: boolean }>;
  unfreezeCard(providerCardId: string): Promise<{ ok: boolean }>;
  cancelCard(providerCardId: string): Promise<{ ok: boolean }>;
  getCard(providerCardId: string): Promise<IssuedCard | null>;
  getCardDetails(providerCardId: string): Promise<CardDetailsReveal>;
  getCardTransactions?(providerCardId: string): Promise<
    Array<{
      providerTransactionId: string;
      amountCents: number;
      merchant: string | null;
      status: string;
      createdAt: Date;
    }>
  >;
}

/** Risk tier labels shared with the verification oracle (no PII). */
export type CardIssuerRiskTier =
  | "UNRATED"
  | "BASIC"
  | "STANDARD"
  | "ELEVATED"
  | "PRIVILEGED";

export interface CardIssuerEligibilityParams {
  agentWallet: string;
  riskTier: CardIssuerRiskTier;
  riskScore: number;
}

export interface CardIssuerEligibilityResult {
  eligible: boolean;
  maxDailyLimitUsd: number;
  reasons: string[];
}

/**
 * Normalized issuing_authorization.request / .created webhook payload.
 * @see https://docs.stripe.com/issuing/purchases/authorizations
 */
export interface IssuingAuthorizationWebhookInput {
  eventId: string;
  eventType: string;
  connectedAccountId: string | null;
  authorizationId: string;
  amountCents: number;
  currency: string;
  merchantName: string | null;
  merchantCategoryCode: string | null;
  cardholderWallet: string | null;
  cardId: string | null;
  agentId: string | null;
  metadata: Record<string, string>;
  rawEvent: unknown;
}

export interface IssuingAuthorizationWebhookResult {
  approved: boolean;
  declineReason?: string;
  /** Response body for Stripe issuing_authorization.request handler. */
  response: { approved: boolean };
  /** Oracle / policy evaluation trace (safe for audit logs — no PII). */
  evaluation: {
    issuer: string;
    riskTierChecked: boolean;
    policyChecked: boolean;
    notes: string[];
  };
}

/** Stripe Issuing + Bridge stablecoin cards (private preview). */
export interface StripeBridgeCardIssuerProvider extends CardIssuerProvider {
  readonly supportsCommercialCards: boolean;
  checkEligibility(
    params: CardIssuerEligibilityParams,
  ): Promise<CardIssuerEligibilityResult>;
  handleAuthorizationWebhook(
    input: IssuingAuthorizationWebhookInput,
  ): Promise<IssuingAuthorizationWebhookResult>;
}

/** Fiat-balance Stripe Issuing (test mode, self-serve). */
export interface StripeIssuingStandardCardIssuerProvider extends CardIssuerProvider {
  checkEligibility(
    params: CardIssuerEligibilityParams,
  ): Promise<CardIssuerEligibilityResult>;
  issueAgentCard(params: {
    appAccountId: string;
    agentId: number;
    agentName: string;
    riskTier: CardIssuerRiskTier;
    maxDailyLimitUsd: number;
    displayName?: string;
    idempotencyKey: string;
    cardUsage?: "multi_use" | "single_use";
  }): Promise<IssuedCard>;
  handleAuthorizationWebhook(
    input: IssuingAuthorizationWebhookInput,
  ): Promise<IssuingAuthorizationWebhookResult>;
  fundIssuingBalance(amountCents: number): Promise<{ amountCents: number }>;
  simulateTestAuthorization(params: {
    stripeCardId: string;
    amountCents: number;
    merchantName?: string;
  }): Promise<{ authorizationId: string }>;
}

/** Crossmint agent wallets + agent cards (stablecoin + order-intent flows). */
export interface CrossmintCardIssuerProvider extends CardIssuerProvider {
  readonly supportsAgentWallets: boolean;
  checkEligibility(
    params: CardIssuerEligibilityParams,
  ): Promise<CardIssuerEligibilityResult>;
  createAgentWallet(params: {
    agentId: number;
    appAccountId: string;
    ownerEmail?: string;
  }): Promise<{ walletAddress: string; ownerLocator: string }>;
  registerAgent(params: {
    userJwt: string;
    name: string;
    description?: string;
  }): Promise<{ crossmintAgentId: string }>;
  issueAgentCard(params: {
    userJwt: string;
    crossmintAgentId: string;
    paymentMethodId: string;
    maxDailyLimitUsd: number;
    mandateDescription?: string;
    expiresAt?: string;
    idempotencyKey: string;
  }): Promise<IssuedCard & { orderIntentId: string; phase: string }>;
  handleAuthorizationWebhook(
    input: IssuingAuthorizationWebhookInput,
  ): Promise<IssuingAuthorizationWebhookResult>;
  handleWalletWebhook(event: CrossmintWalletWebhookEvent): Promise<{
    processed: boolean;
    eventType: string;
  }>;
}

/** Normalized Crossmint wallet webhook (`wallets.transfer.in` / `.out`). */
export interface CrossmintWalletWebhookEvent {
  eventId: string;
  eventType: string;
  walletAddress: string | null;
  amountCents: number;
  currency: string;
  status: string | null;
  agentId: string | null;
  metadata: Record<string, string>;
  rawEvent: unknown;
}

/** Lithic virtual cards + stablecoin ledger + ASA auth stream. */
export interface LithicCardIssuerProvider extends CardIssuerProvider {
  readonly supportsStablecoinLedger: boolean;
  checkEligibility(
    params: CardIssuerEligibilityParams,
  ): Promise<CardIssuerEligibilityResult>;
  createVirtualCard(params: {
    agentId: number;
    appAccountId: string;
    agentName: string;
    riskTier: CardIssuerRiskTier;
    maxDailyLimitUsd: number;
    displayName?: string;
    idempotencyKey: string;
  }): Promise<IssuedCard & { lithicCardToken: string }>;
  handleAuthStreamRequest(body: unknown): Promise<{
    httpStatus: number;
    body: { result: string; approved_amount?: number };
    decision: {
      approved: boolean;
      result: string;
      declineReason?: string;
      notes: string[];
    };
    request: unknown;
    balanceAfterCents: number | null;
  }>;
}

/** AgentRanking virtual cards — Kripicard prepaid API, branded as AR. */
export interface KripicardCardIssuerProvider extends CardIssuerProvider {
  readonly supportsPrepaidBalance: boolean;
  checkEligibility(
    params: CardIssuerEligibilityParams,
  ): Promise<CardIssuerEligibilityResult>;
  createVirtualCard(params: {
    agentId?: number | null;
    appAccountId: string;
    agentName?: string;
    riskTier: CardIssuerRiskTier;
    amountUsd: number;
    bin?: string;
    nameOnCard?: string;
    email?: string;
    dateOfBirth?: string;
    idempotencyKey: string;
  }): Promise<IssuedCard & { kripicardCardId: string; bin: string }>;
  fundCard(params: {
    cardId: string;
    amountUsd: number;
  }): Promise<{
    data: { card_id: string; amount: number; fee: number; total_debited: number };
  }>;
}

/** Optional external wallet rail (Bridge, etc.). Internal ledger is source of truth. */
export interface WalletProvider {
  name: string;
  createWallet?(appAccountId: string): Promise<{ providerWalletId: string }>;
  getBalance?(providerWalletId: string): Promise<{ balanceCents: number }>;
}
