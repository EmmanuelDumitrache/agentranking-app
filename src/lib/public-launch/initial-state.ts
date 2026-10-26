export type PublicLaunchChain = "solana" | "robinhood" | "metaplex";

export function normalizePublicLaunchChain(
  value: string | readonly string[] | null | undefined,
): PublicLaunchChain {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "robinhood" || raw === "metaplex") return raw;
  return "solana";
}

export function publicMetaplexOpenAttemptKey(input: {
  chain: PublicLaunchChain;
  authenticated: boolean;
  attemptId?: string | null;
}): string {
  return `public-metaplex-open-attempt:${input.chain}:${input.authenticated}:${input.attemptId ?? "none"}`;
}
