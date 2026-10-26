export type LavaraveOffer = {
  mint: string;
  symbol: string;
  name: string | null;
  maxLeverage: number;
  icon: string | null;
};

function offerMint(raw: Record<string, unknown>): string | null {
  const candidates = [
    raw.mint,
    raw.tokenMint,
    raw.baseMint,
    raw.address,
    (raw.baseToken as { address?: string } | undefined)?.address,
    (raw.token as { address?: string } | undefined)?.address,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.length >= 32) return value;
  }
  return null;
}

function offerSymbol(raw: Record<string, unknown>): string {
  const ct = raw.collateralToken as { symbol?: string; name?: string } | undefined;
  const embedded = raw.embedded as { symbol?: string; name?: string } | undefined;
  const candidates = [
    raw.symbol,
    raw.ticker,
    raw.baseSymbol,
    raw.name,
    ct?.symbol,
    ct?.name,
    embedded?.symbol,
    embedded?.name,
    (raw.baseToken as { symbol?: string } | undefined)?.symbol,
    (raw.token as { symbol?: string } | undefined)?.symbol,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "TOKEN";
}

function offerMaxLeverage(raw: Record<string, unknown>): number {
  const direct = raw.maxLeverage;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;
  const tiers = raw.leverage;
  if (Array.isArray(tiers) && tiers.length > 0) {
    const max = Math.max(...tiers.filter((v): v is number => typeof v === "number"));
    if (Number.isFinite(max) && max > 0) return max;
  }
  return 5;
}

function offerIcon(raw: Record<string, unknown>): string | null {
  const candidates = [
    raw.icon,
    raw.logo,
    (raw.token as { logoURI?: string; icon?: string } | undefined)?.logoURI,
    (raw.token as { logoURI?: string; icon?: string } | undefined)?.icon,
    (raw.baseToken as { logoURI?: string; icon?: string } | undefined)?.logoURI,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.startsWith("http")) return value;
  }
  return null;
}

export function parseLavaraveOffers(raw: unknown[]): LavaraveOffer[] {
  const seen = new Set<string>();
  const offers: LavaraveOffer[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item == null) continue;
    const row = item as Record<string, unknown>;
    const mint = offerMint(row);
    if (!mint || seen.has(mint)) continue;
    seen.add(mint);
    offers.push({
      mint,
      symbol: offerSymbol(row),
      name: typeof row.name === "string" ? row.name : null,
      maxLeverage: offerMaxLeverage(row),
      icon: offerIcon(row),
    });
  }

  return offers.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
