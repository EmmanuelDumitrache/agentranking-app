export type LavaravePosition = {
  id: string;
  mint: string;
  symbol: string;
  leverage: number;
  positionSizeSol: number | null;
  entryPriceUsd: number | null;
  walletPk: string | null;
};

function positionId(raw: Record<string, unknown>, index: number): string {
  const candidates = [raw.id, raw.positionId, raw.positionID, raw.uuid];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return `pos-${index}`;
}

function positionMint(raw: Record<string, unknown>): string {
  const candidates = [
    raw.mint,
    raw.tokenMint,
    raw.baseMint,
    (raw.token as { mint?: string; address?: string } | undefined)?.mint,
    (raw.token as { mint?: string; address?: string } | undefined)?.address,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.length >= 32) return value;
  }
  return "";
}

function positionSymbol(raw: Record<string, unknown>): string {
  const candidates = [
    raw.symbol,
    (raw.token as { symbol?: string } | undefined)?.symbol,
    raw.ticker,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const mint = positionMint(raw);
  if (mint.length > 12) return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  return "TOKEN";
}

export function parseLavaravePositions(raw: unknown, walletPk?: string | null): LavaravePosition[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw != null && Array.isArray((raw as { positions?: unknown[] }).positions)
      ? ((raw as { positions: unknown[] }).positions ?? [])
      : [];

  return list
    .map((item, index) => {
      if (typeof item !== "object" || item == null) return null;
      const row = item as Record<string, unknown>;
      const mint = positionMint(row);
      if (!mint) return null;

      const leverageRaw = row.leverage ?? row.leverageX ?? row.x;
      const sizeRaw = row.positionSize ?? row.positionSizeSol ?? row.size;
      const entryRaw = row.entryPriceUsd ?? row.entry ?? row.price;

      return {
        id: positionId(row, index),
        mint,
        symbol: positionSymbol(row),
        leverage: typeof leverageRaw === "number" && Number.isFinite(leverageRaw) ? leverageRaw : 1,
        positionSizeSol:
          typeof sizeRaw === "number" && Number.isFinite(sizeRaw)
            ? sizeRaw
            : typeof sizeRaw === "string"
              ? Number.parseFloat(sizeRaw) || null
              : null,
        entryPriceUsd:
          typeof entryRaw === "number" && Number.isFinite(entryRaw)
            ? entryRaw
            : typeof entryRaw === "string"
              ? Number.parseFloat(entryRaw) || null
              : null,
        walletPk:
          typeof row.walletPk === "string"
            ? row.walletPk
            : typeof row.wallet === "string"
              ? row.wallet
              : walletPk ?? null,
      } satisfies LavaravePosition;
    })
    .filter((row): row is LavaravePosition => row != null);
}

export function filterPositionsForWallet(
  positions: LavaravePosition[],
  walletPk: string,
): LavaravePosition[] {
  return positions.filter((p) => !p.walletPk || p.walletPk === walletPk);
}
