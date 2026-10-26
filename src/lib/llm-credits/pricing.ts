import type { SupportedDepositAsset } from "./types";
export function usdCentsToAtomicAmount(
  usdCents: number,
  asset: SupportedDepositAsset,
  solUsdPriceMicros?: bigint,
): bigint {
  if (!Number.isFinite(usdCents) || usdCents < 0) return BigInt(0);
  const usdCentsBI = BigInt(Math.floor(usdCents));
  if (asset === "USDC") {
    // 1 USDC = 1 USD = 100 cents = 10^6 atomic units
    // 1 cent = 10^4 atomic units
    return usdCentsBI * BigInt(10_000);
  }
  if (asset === "SOL") {
    if (!solUsdPriceMicros || solUsdPriceMicros <= BigInt(0)) return BigInt(0);
    // USD per SOL = solUsdPriceMicros / 1_000_000
    // SOL needed = (usdCents / 100) / (solUsdPriceMicros / 1_000_000)
    //            = usdCents * 10_000 / solUsdPriceMicros
    // Lamports = SOL * 10^9 = usdCents * 10_000 * 10^9 / solUsdPriceMicros
    //          = usdCents * 10^13 / solUsdPriceMicros
    return (usdCentsBI * BigInt(10_000_000_000_000)) / solUsdPriceMicros;
  }
  return BigInt(0);
}
export function atomicAmountToUsdCents(
  atomicAmount: bigint,
  asset: SupportedDepositAsset,
  solUsdPriceMicros?: bigint,
): number {
  if (atomicAmount < BigInt(0)) return 0;
  if (asset === "USDC") {
    // 1 cent = 10_000 atomic units
    return Number(atomicAmount / BigInt(10_000));
  }
  if (asset === "SOL") {
    if (!solUsdPriceMicros || solUsdPriceMicros <= BigInt(0)) return 0;
    // usdCents = lamports * solUsdPriceMicros / 10^13
    const usdCentsBI = (atomicAmount * solUsdPriceMicros) / BigInt(10_000_000_000_000);
    return Number(usdCentsBI);
  }
  return 0;
}
export function formatAtomicAmount(
  atomicAmount: bigint,
  asset: SupportedDepositAsset,
): string {
  if (asset === "USDC") {
    const ui = Number(atomicAmount) / 1_000_000;
    return ui.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  }
  if (asset === "SOL") {
    const ui = Number(atomicAmount) / 1_000_000_000;
    return ui.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 9,
    });
  }
  return String(atomicAmount);
}
export function computeMinAmountAtomic(
  expectedAtomic: bigint,
  toleranceBps: number,
): bigint {
  if (toleranceBps <= 0) return expectedAtomic;
  const multiplier = BigInt(10000 - toleranceBps);
  return (expectedAtomic * multiplier) / BigInt(10000);
}
export function computeMaxAmountAtomic(
  expectedAtomic: bigint,
  toleranceBps: number,
): bigint {
  if (toleranceBps <= 0) return expectedAtomic;
  const multiplier = BigInt(10000 + toleranceBps);
  return (expectedAtomic * multiplier) / BigInt(10000);
}