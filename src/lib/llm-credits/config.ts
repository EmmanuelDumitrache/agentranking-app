import type { DepositConfig, SupportedDepositAsset } from "./types";
const QUOTE_TTL_SECONDS = 900;
const SETTLEMENT_COMMITMENT: "confirmed" | "finalized" = "finalized";
const SOL_OVERPAY_TOLERANCE_BPS = 50;
const USDC_OVERPAY_TOLERANCE_BPS = 0;
let cached: DepositConfig | null = null;
export function getDepositConfig(): DepositConfig {
  if (cached) return cached;
  const isProduction = process.env.NODE_ENV === "production";
  const treasuryWallet = process.env.LLM_CREDIT_TREASURY_SOLANA_WALLET?.trim() || undefined;
  if (isProduction && !treasuryWallet) {
    throw new Error(
      "LLM_CREDIT_TREASURY_SOLANA_WALLET is required for LLM credit deposits in production.",
    );
  }
  if (
    isProduction &&
    !process.env.SOLANA_RPC_URL?.trim() &&
    !process.env.SOLANA_RPC_FALLBACK_URL?.trim()
  ) {
    throw new Error(
      "SOLANA_RPC_URL (or SOLANA_RPC_FALLBACK_URL) is required for LLM credit deposits in production.",
    );
  }
  cached = {
    depositAsset: parseDepositAsset(
      process.env.LLM_CREDIT_DEPOSIT_ASSET,
    ),
    minUsdCents: parseNonNegativeInt("LLM_CREDIT_DEPOSIT_MIN_USD_CENTS", 100),
    treasuryWallet,
    quoteTtlSeconds: QUOTE_TTL_SECONDS,
    settlementCommitment: SETTLEMENT_COMMITMENT,
    solOverpayToleranceBps: SOL_OVERPAY_TOLERANCE_BPS,
    usdcOverpayToleranceBps: USDC_OVERPAY_TOLERANCE_BPS,
    costMarginBps: parseNonNegativeInt("LLM_COST_MARGIN_BPS", 0),
  };
  return cached;
}
function parseDepositAsset(
  raw: string | undefined,
): SupportedDepositAsset {
  const val = raw?.trim().toUpperCase();
  if (val === "SOL" || val === "USDC") return val;
  return "USDC";
}
function parseNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}
