"use client";
export function formatWalletSol(lamports: number | null): string {
  if (lamports == null) return "0";
  return (lamports / 1_000_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}
