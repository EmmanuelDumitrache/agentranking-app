import "server-only";

export const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;

export function parseSolAmountToLamports(value: string | number): bigint | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    // A JS number cannot preserve arbitrary decimal precision. SOL inputs are
    // constrained to the chain's 9 decimal places before conversion.
    text = value.toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
  } else {
    text = value.trim();
  }
  if (!/^\d+(?:\.\d{1,9})?$/.test(text)) return null;
  const [wholeRaw, fractionRaw = ""] = text.split(".");
  const whole = BigInt(wholeRaw);
  const fraction = BigInt(fractionRaw.padEnd(9, "0"));
  const lamports = whole * LAMPORTS_PER_SOL_BIGINT + fraction;
  return lamports > 0n ? lamports : null;
}

export function formatLamportsAsSol(lamports: bigint): string {
  const sign = lamports < 0n ? "-" : "";
  const absolute = lamports < 0n ? -lamports : lamports;
  const whole = absolute / LAMPORTS_PER_SOL_BIGINT;
  const fraction = (absolute % LAMPORTS_PER_SOL_BIGINT)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}
