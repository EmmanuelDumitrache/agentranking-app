import { parseUnits } from "viem";
const TIER_SCALE_DECIMALS = 18;
const MAX_FRACTION_DIGITS = 18;
/**
 * Normalize user-typed amounts: thousands commas, optional decimals (. or ,).
 * Returns a string suitable for viem `parseUnits`, e.g. "250000" or "250000.5".
 */
export function normalizeHumanAmountString(input: string): string | null {
  const trimmed = input.trim().replace(/[\s_]/g, "");
  if (!trimmed) return null;
  if (!/^[\d.,]+$/.test(trimmed)) return null;
  const lastDot = trimmed.lastIndexOf(".");
  const lastComma = trimmed.lastIndexOf(",");
  let intPart: string;
  let fracPart: string;
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastDot > lastComma) {
      const dotIdx = trimmed.lastIndexOf(".");
      intPart = trimmed.slice(0, dotIdx).replace(/,/g, "");
      fracPart = trimmed.slice(dotIdx + 1);
    } else {
      const commaIdx = trimmed.lastIndexOf(",");
      intPart = trimmed.slice(0, commaIdx).replace(/\./g, "");
      fracPart = trimmed.slice(commaIdx + 1);
    }
  } else if (lastComma >= 0) {
    const segments = trimmed.split(",");
    if (segments.length === 1) return null;
    const lastSeg = segments[segments.length - 1] ?? "";
    if (
      segments.length === 2 &&
      lastSeg.length > 0 &&
      lastSeg.length <= 2
    ) {
      intPart = segments[0] ?? "";
      fracPart = lastSeg;
    } else if (segments.every((seg, i) => i === 0 || seg.length === 3)) {
      intPart = segments.join("");
      fracPart = "";
    } else {
      return null;
    }
  } else if (lastDot >= 0) {
    const parts = trimmed.split(".");
    if (parts.length !== 2) return null;
    intPart = parts[0] ?? "";
    fracPart = parts[1] ?? "";
  } else {
    intPart = trimmed;
    fracPart = "";
  }
  if (!intPart || !/^\d+$/.test(intPart)) return null;
  if (fracPart && !/^\d+$/.test(fracPart)) return null;
  if (intPart.length > 1 && intPart.startsWith("0") && !intPart.startsWith("0.")) {
    intPart = intPart.replace(/^0+/, "") || "0";
  }
  const frac = fracPart.slice(0, MAX_FRACTION_DIGITS);
  return frac ? `${intPart}.${frac}` : intPart;
}
export function isValidStakingAmountInput(input: string): boolean {
  return normalizeHumanAmountString(input) != null;
}
/** Parse human $AR amount into 18-decimal tier scale (matches holder tier thresholds). */
export function parseArAmountToTierScale(amountStr: string): bigint {
  const normalized = normalizeHumanAmountString(amountStr);
  if (!normalized) return BigInt(0);
  try {
    return parseUnits(normalized, TIER_SCALE_DECIMALS);
  } catch {
    return BigInt(0);
  }
}
/** Finite positive number for Streamflow stake UI / getBN (best-effort). */
export function parseHumanAmountNumber(input: string): number | null {
  const normalized = normalizeHumanAmountString(input);
  if (!normalized) return null;
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}