import {
  METAPLEX_IRYS_GATEWAY_PREFIX,
  METAPLEX_TOKEN_DESCRIPTION_MAX,
  METAPLEX_TOKEN_NAME_MAX,
  METAPLEX_TOKEN_SYMBOL_MAX,
} from "@/lib/metaplex-launch/constants";

export type MetaplexLaunchFormFields = {
  tokenName: string;
  tokenSymbol: string;
  tokenDescription: string;
  tokenImageUrl: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  firstBuySol?: string;
};

const IRYS_TX_ID_RE = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * Normalize common Irys / Arweave receipt URLs to the required gateway form.
 * Returns null when the URI cannot be expressed as https://gateway.irys.xyz/<id>.
 */
export function normalizeIrysGatewayUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim() ?? "";
  if (!trimmed) return null;

  if (trimmed.startsWith(METAPLEX_IRYS_GATEWAY_PREFIX)) {
    const id = trimmed.slice(METAPLEX_IRYS_GATEWAY_PREFIX.length).split(/[?#]/)[0]?.trim();
    return id && IRYS_TX_ID_RE.test(id) ? `${METAPLEX_IRYS_GATEWAY_PREFIX}${id}` : null;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const pathId = parsed.pathname.replace(/^\/+/, "").split("/")[0]?.trim() ?? "";

    if (
      (host === "gateway.irys.xyz" ||
        host === "arweave.net" ||
        host === "www.arweave.net" ||
        host.endsWith(".irys.xyz")) &&
      IRYS_TX_ID_RE.test(pathId)
    ) {
      return `${METAPLEX_IRYS_GATEWAY_PREFIX}${pathId}`;
    }
  } catch {
    // not a URL
  }

  if (IRYS_TX_ID_RE.test(trimmed)) {
    return `${METAPLEX_IRYS_GATEWAY_PREFIX}${trimmed}`;
  }

  return null;
}

export function isValidIrysGatewayUrl(url: string | null | undefined): boolean {
  return normalizeIrysGatewayUrl(url) != null;
}

export function validateMetaplexTokenName(name: string | undefined): string | null {
  if (name === undefined) return null;
  const trimmed = name.trim();
  if (!trimmed) return "Token name is required";
  if (trimmed.length > METAPLEX_TOKEN_NAME_MAX) {
    return `Token name must be at most ${METAPLEX_TOKEN_NAME_MAX} characters`;
  }
  return null;
}

export function validateMetaplexTokenSymbol(symbol: string | undefined): string | null {
  if (symbol === undefined) return null;
  const trimmed = symbol.trim().toUpperCase();
  if (!trimmed) return "Token symbol is required";
  if (trimmed.length > METAPLEX_TOKEN_SYMBOL_MAX) {
    return `Token symbol must be at most ${METAPLEX_TOKEN_SYMBOL_MAX} characters`;
  }
  if (!/^[A-Z0-9]+$/.test(trimmed)) {
    return "Token symbol must be alphanumeric";
  }
  return null;
}

export function validateMetaplexTokenDescription(description: string | undefined): string | null {
  if (description === undefined) return null;
  const trimmed = description.trim();
  if (!trimmed) return "Token description is required";
  // Genesis API hard-caps at METAPLEX_TOKEN_DESCRIPTION_MAX — we truncate at submit time.
  return null;
}

/** Metaplex Genesis rejects descriptions over 250 chars; keep full text elsewhere. */
export function truncateMetaplexTokenDescription(description: string | undefined): string {
  return (description ?? "").trim().slice(0, METAPLEX_TOKEN_DESCRIPTION_MAX);
}

export function validateMetaplexIrysImageUrl(url: string | undefined): string | null {
  if (url === undefined) return null;
  const trimmed = url.trim();
  if (!trimmed) return "Upload a token image before launching.";
  if (!normalizeIrysGatewayUrl(trimmed)) {
    return "Upload a token image with the Upload image button before launching.";
  }
  return null;
}

/**
 * Draft / upload bootstrap: allow empty image and incomplete name fields.
 * If an image URL is present it must already be (or normalize to) Irys gateway.
 */
export function validateMetaplexLaunchDraft(fields: MetaplexLaunchFormFields): string | null {
  const name = fields.tokenName?.trim() ?? "";
  if (name) {
    const nameErr = validateMetaplexTokenName(name);
    if (nameErr) return nameErr;
  }
  const symbol = fields.tokenSymbol?.trim() ?? "";
  if (symbol) {
    const symbolErr = validateMetaplexTokenSymbol(symbol);
    if (symbolErr) return symbolErr;
  }
  const description = fields.tokenDescription?.trim() ?? "";
  if (description) {
    const descErr = validateMetaplexTokenDescription(description);
    if (descErr) return descErr;
  }
  const image = fields.tokenImageUrl?.trim() ?? "";
  if (image && !isValidIrysGatewayUrl(image)) {
    return "Upload a token image with the Upload image button before launching.";
  }
  return validateMetaplexFirstBuySol(fields.firstBuySol);
}

export function validateMetaplexFirstBuySol(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  const num = Number.parseFloat(value.trim());
  if (!Number.isFinite(num) || num < 0) {
    return "First buy must be a non-negative SOL amount";
  }
  return null;
}

export function validateMetaplexLaunchForm(fields: MetaplexLaunchFormFields): string | null {
  return (
    validateMetaplexTokenName(fields.tokenName) ??
    validateMetaplexTokenSymbol(fields.tokenSymbol) ??
    validateMetaplexTokenDescription(fields.tokenDescription) ??
    validateMetaplexIrysImageUrl(fields.tokenImageUrl) ??
    validateMetaplexFirstBuySol(fields.firstBuySol)
  );
}

export function parseMetaplexFirstBuySol(value: string | undefined): number {
  if (!value?.trim()) return 0;
  const num = Number.parseFloat(value.trim());
  return Number.isFinite(num) && num >= 0 ? num : 0;
}
