/**
 * Provider-agnostic adapter contracts for the Verification Layer.
 *
 * CRITICAL: Do not put partner brand names in domain types, schema, or routes.
 * Concrete providers are selected only via env (KYC_PROVIDER / CARD_ISSUER).
 */

export type RiskTier =
  | "UNRATED"
  | "BASIC"
  | "STANDARD"
  | "ELEVATED"
  | "PRIVILEGED";

export type PassportStatus =
  | "PENDING"
  | "ACTIVE"
  | "SUSPENDED"
  | "REVOKED"
  | "EXPIRED";

export type KycSessionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "needs_review";

export interface KycProvider {
  name: string;
  /** Returns a hosted verification session URL. */
  createSession(params: {
    referenceId: string;
    callbackUrl: string;
  }): Promise<{ sessionId: string; url: string }>;
  /** Returns status only — NEVER PII. */
  getStatus(sessionId: string): Promise<{
    status: KycSessionStatus;
    providerRef: string;
    completedAt?: Date;
  }>;
  verifyWebhook(payload: unknown, signature: string): boolean;
}

export interface CardIssuerEligibilityParams {
  agentWallet: string;
  riskTier: RiskTier;
  riskScore: number;
}

export interface CardIssuerEligibilityResult {
  eligible: boolean;
  maxDailyLimitUsd: number;
  reasons: string[];
}

export interface CardIssuer {
  name: string;
  supportsAgentCards: boolean;
  checkEligibility(
    params: CardIssuerEligibilityParams,
  ): Promise<CardIssuerEligibilityResult>;
  /** Phase 2 — not implemented in Phase 1. */
  requestCard?(params: unknown): Promise<unknown>;
}
