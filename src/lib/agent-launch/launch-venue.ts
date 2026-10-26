export type SolanaLaunchVenue = "pumpswap" | "metaplex";

export type LinkedTokenVenueLabel = "PumpSwap" | "Metaplex" | "Robinhood";

export const METAPLEX_PROTOCOL_LOGO = "/branding/metaplex/metaplex-icon.png";

export function isMetaplexGenesisLaunch(launchKind: string | null | undefined): boolean {
  return launchKind?.trim().toLowerCase() === "metaplex_genesis";
}

export function resolveSolanaLaunchVenue(
  launchKind: string | null | undefined,
): SolanaLaunchVenue {
  return isMetaplexGenesisLaunch(launchKind) ? "metaplex" : "pumpswap";
}

export function resolveLinkedTokenVenueLabel(input: {
  chain: "solana" | "robinhood" | null;
  launchKind?: string | null;
}): LinkedTokenVenueLabel | null {
  if (input.chain === "robinhood") return "Robinhood";
  if (input.chain === "solana") {
    return isMetaplexGenesisLaunch(input.launchKind) ? "Metaplex" : "PumpSwap";
  }
  return null;
}

export function metaplexGenesisTokenUrl(mint: string): string {
  return `https://www.metaplex.com/token/${encodeURIComponent(mint.trim())}`;
}

export function primarySolanaTradeUrl(input: {
  mint: string;
  launchKind?: string | null;
  pumpFunUrl?: string | null;
}): { href: string; label: string } | null {
  const mint = input.mint.trim();
  if (!mint) return null;
  if (isMetaplexGenesisLaunch(input.launchKind)) {
    return { href: metaplexGenesisTokenUrl(mint), label: "Open on Metaplex" };
  }
  if (input.pumpFunUrl) {
    return { href: input.pumpFunUrl, label: "Open on Pump.fun" };
  }
  return null;
}
