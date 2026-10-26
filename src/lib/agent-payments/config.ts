/**
 * Agent payments product config — env-driven, no vendor names in callers.
 */

import { isDeveloperDevToolsActive } from "@/lib/dashboard/developer-access";

const DEFAULT_CARD_ISSUANCE_FEE_CENTS = 2500;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getCardIssuanceFeeCents(): number {
  return parsePositiveInt(process.env.CARD_ISSUANCE_FEE_CENTS, DEFAULT_CARD_ISSUANCE_FEE_CENTS);
}

/** Waives issuance fee in non-production when explicitly enabled. Never client-controlled. */
export function isCardIssuanceDevBypassActive(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const raw = process.env.CARD_ISSUANCE_DEV_BYPASS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Full AR card UI flow without real USDT / Kripicard charges.
 * Non-production only. Cards are not spendable at merchants.
 */
export function isArCardDemoFlowActive(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const raw = process.env.AR_CARD_DEMO_FLOW?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function cardIssuanceRequiresPayment(): boolean {
  if (isCardIssuanceDevBypassActive() || isArCardDemoFlowActive()) return false;
  return getCardIssuanceFeeCents() > 0;
}

/** Card dev panel — developer allowlist only (mirrors production gating in local dev). */
export function isCardDevToolsActive(accountEmail?: string | null): boolean {
  return isDeveloperDevToolsActive(accountEmail);
}

export function getCardIssuanceQuote() {
  const feeCents = getCardIssuanceFeeCents();
  const devBypassActive = isCardIssuanceDevBypassActive();
  const demoFlowActive = isArCardDemoFlowActive();
  return {
    feeCents: demoFlowActive ? 0 : feeCents,
    currency: "USDC" as const,
    devBypassActive,
    demoFlowActive,
    requiresPayment: !devBypassActive && !demoFlowActive && feeCents > 0,
  };
}
