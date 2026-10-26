import { MEDUSA_METADATA_KEYS } from "@/lib/medusa/config";
import {
  MEDUSA_PASSPORT_TIERS,
  MEDUSA_PASSPORT_USE_CASES,
} from "@/lib/medusa/types";
import type {
  MedusaPassportAgentState,
  MedusaPassportMetadata,
  MedusaPassportMetadataInput,
  MedusaPassportTier,
  MedusaPassportUseCase,
  MedusaPassportWalletVerification,
} from "@/lib/medusa/types";
export type MetadataEntry = { readonly key: string; readonly value: string };
function metadataValue(metadata: readonly MetadataEntry[], key: string): string | undefined {
  const entry = metadata.find((m) => m.key === key);
  return entry?.value?.trim() || undefined;
}
function parseBooleanTrue(value: string | undefined): boolean {
  return value != null && value.toLowerCase() === "true";
}
export function isMedusaPassportUseCase(value: string): value is MedusaPassportUseCase {
  return (MEDUSA_PASSPORT_USE_CASES as readonly string[]).includes(value);
}
export function isMedusaPassportTier(value: string): value is MedusaPassportTier {
  return (MEDUSA_PASSPORT_TIERS as readonly string[]).includes(value);
}
export function parseMedusaPassportUseCase(
  value: string | undefined,
): MedusaPassportUseCase | undefined {
  if (!value) return undefined;
  return isMedusaPassportUseCase(value) ? value : undefined;
}
export function parseMedusaPassportTier(value: string | undefined): MedusaPassportTier | undefined {
  if (!value) return undefined;
  return isMedusaPassportTier(value) ? value : undefined;
}
/** Parse declared Medusa Passport metadata from agent metadata rows. */
export function parseMedusaPassportFromMetadata(
  metadata: readonly MetadataEntry[],
): MedusaPassportMetadata | null {
  const supported = parseBooleanTrue(
    metadataValue(metadata, MEDUSA_METADATA_KEYS.supported),
  );
  if (!supported) return null;
  const useCase = parseMedusaPassportUseCase(
    metadataValue(metadata, MEDUSA_METADATA_KEYS.useCase),
  );
  const minTier = parseMedusaPassportTier(
    metadataValue(metadata, MEDUSA_METADATA_KEYS.minTier),
  );
  return {
    supported: true,
    ...(useCase ? { useCase } : {}),
    ...(minTier ? { minTier } : {}),
  };
}
export function parseMedusaPassportWalletVerification(
  metadata: readonly MetadataEntry[],
): MedusaPassportWalletVerification | null {
  const verified = parseBooleanTrue(
    metadataValue(metadata, MEDUSA_METADATA_KEYS.walletVerified),
  );
  if (!verified) return null;
  const tier = parseMedusaPassportTier(
    metadataValue(metadata, MEDUSA_METADATA_KEYS.verifiedTier),
  );
  const verifiedAt = metadataValue(metadata, MEDUSA_METADATA_KEYS.verifiedAt);
  if (!tier || !verifiedAt) return null;
  const claimWallet = metadataValue(metadata, MEDUSA_METADATA_KEYS.claimWallet);
  const nullifier = metadataValue(metadata, MEDUSA_METADATA_KEYS.nullifier);
  return {
    verified: true,
    tier,
    verifiedAt,
    ...(claimWallet ? { claimWallet } : {}),
    ...(nullifier ? { nullifier } : {}),
  };
}
export function parseMedusaPassportAgentState(
  metadata: readonly MetadataEntry[],
): MedusaPassportAgentState | null {
  const declared = parseMedusaPassportFromMetadata(metadata);
  if (!declared) return null;
  const walletVerification = parseMedusaPassportWalletVerification(metadata);
  return {
    ...declared,
    ...(walletVerification ? { walletVerification } : {}),
  };
}
/** Normalize dashboard/API input into metadata key/value pairs to upsert or delete. */
export function medusaPassportToMetadataEntries(
  input: MedusaPassportMetadataInput,
): MetadataEntry[] {
  if (!input.supported) return [];
  const entries: MetadataEntry[] = [
    { key: MEDUSA_METADATA_KEYS.supported, value: "true" },
  ];
  if (input.useCase && isMedusaPassportUseCase(input.useCase)) {
    entries.push({ key: MEDUSA_METADATA_KEYS.useCase, value: input.useCase });
  }
  if (input.minTier && isMedusaPassportTier(input.minTier)) {
    entries.push({ key: MEDUSA_METADATA_KEYS.minTier, value: input.minTier });
  }
  return entries;
}
export function medusaPassportMetadataKeysToClear(): readonly string[] {
  return [
    MEDUSA_METADATA_KEYS.supported,
    MEDUSA_METADATA_KEYS.useCase,
    MEDUSA_METADATA_KEYS.minTier,
    ...medusaPassportVerificationMetadataKeysToClear(),
  ];
}
export function medusaPassportVerificationMetadataKeysToClear(): readonly string[] {
  return [
    MEDUSA_METADATA_KEYS.walletVerified,
    MEDUSA_METADATA_KEYS.verifiedTier,
    MEDUSA_METADATA_KEYS.claimWallet,
    MEDUSA_METADATA_KEYS.verifiedAt,
    MEDUSA_METADATA_KEYS.nullifier,
  ];
}
export function medusaPassportVerificationToMetadataEntries(
  verification: MedusaPassportWalletVerification,
): MetadataEntry[] {
  const entries: MetadataEntry[] = [
    { key: MEDUSA_METADATA_KEYS.walletVerified, value: "true" },
    { key: MEDUSA_METADATA_KEYS.verifiedTier, value: verification.tier },
    { key: MEDUSA_METADATA_KEYS.verifiedAt, value: verification.verifiedAt },
  ];
  if (verification.claimWallet) {
    entries.push({ key: MEDUSA_METADATA_KEYS.claimWallet, value: verification.claimWallet });
  }
  if (verification.nullifier) {
    entries.push({ key: MEDUSA_METADATA_KEYS.nullifier, value: verification.nullifier });
  }
  return entries;
}
export function medusaPassportUseCaseLabel(useCase: MedusaPassportUseCase): string {
  switch (useCase) {
    case "access_gating":
      return "Access gating";
    case "jobs":
      return "Jobs";
    case "whitelist":
      return "Whitelist";
    case "agent_verification":
      return "Agent verification";
    case "other":
      return "Other";
    default: {
      const _exhaustive: never = useCase;
      return _exhaustive;
    }
  }
}
export function medusaPassportTierLabel(tier: MedusaPassportTier): string {
  switch (tier) {
    case "bronze":
      return "Bronze";
    case "silver":
      return "Silver";
    case "gold":
      return "Gold";
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}
