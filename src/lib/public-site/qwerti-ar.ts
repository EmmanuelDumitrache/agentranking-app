export const QWERTI_AR_TOKEN_NAME = "AgentRanking";
export const QWERTI_AR_TOKEN_SYMBOL = "AR";
export const QWERTI_AR_SOLANA_CA = "92eXvBFGBAXwgmPf6t6CUCNJH2xChsCJuWzaGPjyPUmP";
export const QWERTI_AR_CAMPAIGN = "ar-792703809-10622";
export const QWERTI_WIDGET_SCRIPT_SRC = "https://widget.qwerti.ai/widget/v1/buy.js";
const DEFAULT_QWERTI_AR_LINK =
  "https://app.qwerti.ai/buy/92eXvBFGBAXwgmPf6t6CUCNJH2xChsCJuWzaGPjyPUmP/792703809?campaign=ar-792703809-10622";
/** Override with `NEXT_PUBLIC_QWERTI_AR_LINK` (baked at build). */
export function resolveQwertiArLinkFromEnv(): string {
  const raw = process.env.NEXT_PUBLIC_QWERTI_AR_LINK?.trim();
  if (raw && /^https?:\/\//i.test(raw)) return raw;
  return DEFAULT_QWERTI_AR_LINK;
}
