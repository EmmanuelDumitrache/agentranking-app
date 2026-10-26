import {
  medusaPassportTierLabel,
  medusaPassportUseCaseLabel,
  parseMedusaPassportAgentState,
  type MetadataEntry,
} from "@/lib/medusa/metadata";
import type { TrustSummaryTile } from "@/lib/signals/types";
export const MEDUSA_PASSPORT_TRUST_TILE_KEY = "medusa_passport";
/** Human-readable status line for dashboard trust grid (tier · use case). */
export function formatMedusaPassportStatusDetail(
  metadata: readonly MetadataEntry[],
): string {
  const parsed = parseMedusaPassportAgentState(metadata);
  if (!parsed) return "—";
  const parts: string[] = [];
  if (parsed.walletVerification) {
    parts.push(medusaPassportTierLabel(parsed.walletVerification.tier));
  } else if (parsed.minTier) {
    parts.push(`Min ${medusaPassportTierLabel(parsed.minTier)}`);
  }
  if (parsed.useCase) parts.push(medusaPassportUseCaseLabel(parsed.useCase));
  return parts.length > 0 ? parts.join(" · ") : "—";
}
/** Dashboard trust grid tile — Declared vs Verified (SDK wallet check). */
export function buildMedusaPassportTrustTile(
  metadata: readonly MetadataEntry[],
): TrustSummaryTile {
  const parsed = parseMedusaPassportAgentState(metadata);
  if (!parsed) {
    return {
      key: MEDUSA_PASSPORT_TRUST_TILE_KEY,
      label: "MEDUSA PASSPORT",
      value: "Not declared",
      status: "unknown",
      statusLabel: "—",
      title: "Owner has not declared Medusa Passport support",
    };
  }
  if (parsed.walletVerification) {
    return {
      key: MEDUSA_PASSPORT_TRUST_TILE_KEY,
      label: "MEDUSA PASSPORT",
      value: "Verified",
      status: "verified",
      statusLabel: formatMedusaPassportStatusDetail(metadata),
      title: "Wallet passport cryptographically verified via Medusa SDK.",
    };
  }
  return {
    key: MEDUSA_PASSPORT_TRUST_TILE_KEY,
    label: "MEDUSA PASSPORT",
    value: "Declared",
    status: "unknown",
    statusLabel: formatMedusaPassportStatusDetail(metadata),
    title: "Owner-declared Medusa Passport support. Wallet not verified yet.",
  };
}
export function appendMedusaPassportTrustTile(
  tiles: readonly TrustSummaryTile[],
  metadata: readonly MetadataEntry[],
): TrustSummaryTile[] {
  const without = tiles.filter((t) => t.key !== MEDUSA_PASSPORT_TRUST_TILE_KEY);
  return [...without, buildMedusaPassportTrustTile(metadata)];
}
