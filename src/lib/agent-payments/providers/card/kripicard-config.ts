export interface KripicardConfig {
  configured: boolean;
  apiKey: string;
  apiBaseUrl: string;
  defaultBin: string;
  defaultCurrency: string;
  defaultNetwork: string;
}

const DEFAULT_BASE_URL = "https://api.kripicard.com";

export function getKripicardConfig(): KripicardConfig {
  const apiKey = (process.env.KRIPICARD_API_KEY ?? "").trim();
  const apiBaseUrl = (process.env.KRIPICARD_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    "",
  );
  const defaultBin = (process.env.KRIPICARD_DEFAULT_BIN ?? "539502").trim();
  const defaultCurrency = (process.env.KRIPICARD_DEPOSIT_CURRENCY ?? "USDT").trim();
  const defaultNetwork = (process.env.KRIPICARD_DEPOSIT_NETWORK ?? "trx").trim();

  return {
    configured: apiKey.length > 0,
    apiKey,
    apiBaseUrl,
    defaultBin,
    defaultCurrency,
    defaultNetwork,
  };
}

/** Map verification risk tier → Kripicard BIN. */
export function binForRiskTier(tier: string): string {
  switch (tier) {
    case "PRIVILEGED":
      return process.env.KRIPICARD_BIN_PRIVILEGED ?? "525847";
    case "ELEVATED":
      return process.env.KRIPICARD_BIN_ELEVATED ?? "537872";
    case "STANDARD":
      return process.env.KRIPICARD_BIN_STANDARD ?? "525847";
    case "BASIC":
      return process.env.KRIPICARD_BIN_BASIC ?? "539502";
    case "UNRATED":
    default:
      return process.env.KRIPICARD_DEFAULT_BIN ?? "539502";
  }
}

export function binsRequiringDateOfBirth(): Set<string> {
  return new Set(["537872", "533171", "246001"]);
}
