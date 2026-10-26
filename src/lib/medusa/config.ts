/** Medusa partner constants for the current static documentation integration. */
export const MEDUSA_PARTNER_SLUG = "medusa" as const;
export const MEDUSA_LOGO_SRC = "/partners/medusa/logo.png";
export const MEDUSA_WEBSITE_URL = "https://www.zkmedusa.com";
export const MEDUSA_DOCS_URL = "https://www.zkmedusa.com/docs";
export const MEDUSA_PARTNER_DOCS_PATH = "/docs/partners/medusa";
/** Default issuer public key (hex) — override with MEDUSA_ISSUER_PUBLIC_KEY. */
export const MEDUSA_DEFAULT_ISSUER_PUBLIC_KEY =
  "749d6135f3d883950ff82f82bc2119e8b6e469ebfc4163dd10e1cc079b723565";
export const MEDUSA_METADATA_KEYS = {
  supported: "medusaPassportSupported",
  useCase: "medusaPassportUseCase",
  minTier: "medusaMinTier",
  walletVerified: "medusaPassportWalletVerified",
  verifiedTier: "medusaPassportVerifiedTier",
  claimWallet: "medusaPassportClaimWallet",
  verifiedAt: "medusaPassportVerifiedAt",
  nullifier: "medusaPassportNullifier",
} as const;
export function resolveMedusaBaseUrl(): string {
  const raw = process.env.MEDUSA_BASE_URL?.trim() || process.env.MEDUSA_PASSPORT_BASE_URL?.trim();
  return (raw || MEDUSA_WEBSITE_URL).replace(/\/$/, "");
}
export function resolveMedusaIssuerPublicKey(): string {
  return (
    process.env.MEDUSA_ISSUER_PUBLIC_KEY?.trim() ||
    process.env.MEDUSA_PASSPORT_ISSUER_PUBLIC_KEY?.trim() ||
    MEDUSA_DEFAULT_ISSUER_PUBLIC_KEY
  );
}
