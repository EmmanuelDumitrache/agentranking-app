import { getDepositConfig } from "../config";
/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */
export type ParseUsdResult =
  | { ok: true; cents: number }
  | { ok: false; error: string };
/* ------------------------------------------------------------------ */
/*  Limits                                                              */
/* ------------------------------------------------------------------ */
const DEFAULT_MAX_USD_CENTS = 100_000; // $1,000.00
function getMaxUsdCents(): number {
  const raw = process.env.LLM_CREDIT_DEPOSIT_MAX_USD_CENTS?.trim();
  if (raw != null && raw !== "") {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MAX_USD_CENTS;
}
/* ------------------------------------------------------------------ */
/*  Parser                                                              */
/* ------------------------------------------------------------------ */
/**
 * Parse a USD string like "5.00" or "100" into integer cents.
 *
 * - Accepts at most 2 fractional digits.
 * - Rejects signs, exponent notation, commas, whitespace-only, empty strings.
 * - Converts via string splitting (never `Number(value) * 100`).
 * - Enforces configurable min/max bounds.
 */
export function parseUsdToCents(input: string): ParseUsdResult {
  // Reject empty / whitespace-only
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "Amount is required" };
  }
  // Reject any input containing exponent notation
  if (/[eE]/.test(trimmed)) {
    return { ok: false, error: "Scientific notation not allowed" };
  }
  // Reject commas — not a valid locale-agnostic USD literal
  if (trimmed.includes(",")) {
    return { ok: false, error: "Commas not allowed" };
  }
  // Reject explicit sign characters
  if (trimmed.startsWith("+") || trimmed.startsWith("-")) {
    return { ok: false, error: "Sign characters not allowed" };
  }
  // Validate character set: only digits and at most one decimal point
  const parts = trimmed.split(".");
  if (parts.length > 2) {
    return { ok: false, error: "Multiple decimal points" };
  }
  const integerPart = parts[0]!;
  const fractionalPart = parts[1] ?? "";
  // Integer part must be digits only
  if (!/^\d+$/.test(integerPart)) {
    return { ok: false, error: "Invalid integer digits" };
  }
  // Fractional part must be digits only (up to 2)
  if (fractionalPart !== "" && !/^\d{1,2}$/.test(fractionalPart)) {
    return { ok: false, error: "At most 2 decimal places allowed" };
  }
  // Reject leading zeros on multi-digit integer part (e.g. "001.00")
  if (integerPart.length > 1 && integerPart.startsWith("0")) {
    return { ok: false, error: "Leading zeros not allowed" };
  }
  // Convert via string ops
  let cents: number;
  if (fractionalPart === "") {
    cents = Number.parseInt(integerPart, 10) * 100;
  } else if (fractionalPart.length === 1) {
    // e.g., "5.5" → 5*100 + 50 = 550
    const whole = Number.parseInt(integerPart, 10);
    const frac = Number.parseInt(fractionalPart, 10) * 10;
    cents = whole * 100 + frac;
  } else {
    // fractionalPart.length === 2, e.g., "5.55" → 5*100 + 55 = 555
    const whole = Number.parseInt(integerPart, 10);
    const frac = Number.parseInt(fractionalPart, 10);
    cents = whole * 100 + frac;
  }
  // Sanity: ensure we produced a safe integer
  if (!Number.isSafeInteger(cents)) {
    return { ok: false, error: "Amount too large" };
  }
  // Enforce min (from config) and max
  let minCents: number;
  try {
    minCents = getDepositConfig().minUsdCents;
  } catch {
    // Config unavailable — use env fallback
    const raw = process.env.LLM_CREDIT_DEPOSIT_MIN_USD_CENTS?.trim();
    minCents = raw != null && raw !== "" ? Number(raw) : 100;
  }
  if (cents < minCents) {
    return {
      ok: false,
      error: `Minimum deposit is $${(minCents / 100).toFixed(2)}`,
    };
  }
  const maxCents = getMaxUsdCents();
  if (cents > maxCents) {
    return {
      ok: false,
      error: `Maximum deposit is $${(maxCents / 100).toFixed(2)}`,
    };
  }
  return { ok: true, cents };
}