/** Medusa Passport declared-support metadata (owner-declared, not AgentRanking-verified). */
export const MEDUSA_PASSPORT_USE_CASES = [
  "access_gating",
  "jobs",
  "whitelist",
  "agent_verification",
  "other",
] as const;
export type MedusaPassportUseCase = (typeof MEDUSA_PASSPORT_USE_CASES)[number];
export const MEDUSA_PASSPORT_TIERS = ["bronze", "silver", "gold"] as const;
export type MedusaPassportTier = (typeof MEDUSA_PASSPORT_TIERS)[number];
export type MedusaPassportMetadata = {
  readonly supported: true;
  readonly useCase?: MedusaPassportUseCase;
  readonly minTier?: MedusaPassportTier;
};
export type MedusaPassportMetadataInput = {
  readonly supported: boolean;
  readonly useCase?: MedusaPassportUseCase | null;
  readonly minTier?: MedusaPassportTier | null;
};
export type MedusaPassportWalletVerification = {
  readonly verified: true;
  readonly tier: MedusaPassportTier;
  readonly claimWallet?: string;
  readonly verifiedAt: string;
  readonly nullifier?: string;
};
export type MedusaPassportAgentState = MedusaPassportMetadata & {
  readonly walletVerification?: MedusaPassportWalletVerification;
};
