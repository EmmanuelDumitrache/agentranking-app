import type {
  AccountVerificationLevel,
  AccountVerificationStatus,
} from "@/generated/prisma/client";

export type { AccountVerificationLevel, AccountVerificationStatus };

export type PublicAccountCredential = {
  publicId: string;
  level: AccountVerificationLevel;
  status: AccountVerificationStatus;
  verifiedAt: string | null;
  expiresAt: string | null;
  schemaVersion: 1;
};

export type AccountVerificationSnapshot = {
  appAccountId: string;
  publicId: string;
  level: AccountVerificationLevel;
  status: AccountVerificationStatus;
  verifiedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  isVerified: boolean;
  canIssueCards: boolean;
  credential: PublicAccountCredential;
};

export function isAccountVerifiedStatus(
  status: AccountVerificationStatus,
  expiresAt: Date | null,
): boolean {
  if (status !== "VERIFIED") return false;
  if (expiresAt && expiresAt.getTime() < Date.now()) return false;
  return true;
}

export function toPublicCredential(params: {
  publicId: string;
  level: AccountVerificationLevel;
  status: AccountVerificationStatus;
  verifiedAt: Date | null;
  expiresAt: Date | null;
}): PublicAccountCredential {
  return {
    publicId: params.publicId,
    level: params.level,
    status: params.status,
    verifiedAt: params.verifiedAt?.toISOString() ?? null,
    expiresAt: params.expiresAt?.toISOString() ?? null,
    schemaVersion: 1,
  };
}
