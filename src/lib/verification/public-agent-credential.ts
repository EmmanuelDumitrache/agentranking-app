import type {
  AccountVerificationLevel,
  AccountVerificationStatus,
} from "@/generated/prisma/client";
import {
  isAccountVerifiedStatus,
  type PublicAccountCredential,
} from "@/lib/verification/account-verification-types";

export type PublicAgentCredentialAbsent = {
  readonly present: false;
};

export type PublicAgentCredentialPresent = PublicAccountCredential & {
  readonly present: true;
  readonly proofPath: string;
};

export type PublicAgentCredential =
  | PublicAgentCredentialAbsent
  | PublicAgentCredentialPresent;

export type OwnerCredentialSource = {
  readonly publicId?: string | null;
  readonly verificationLevel?: AccountVerificationLevel | null;
  readonly verificationStatus: AccountVerificationStatus;
  readonly verificationExpiresAt?: Date | string | null;
  readonly verifiedAt?: Date | string | null;
};

export function credentialProofPath(publicId: string): string {
  return `/api/verification/credential/${encodeURIComponent(publicId)}`;
}

export function credentialProofUrl(publicId: string, origin?: string): string {
  const path = credentialProofPath(publicId);
  if (origin) return `${origin.replace(/\/$/, "")}${path}`;
  if (typeof window !== "undefined") return `${window.location.origin}${path}`;
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "https://app.agentranking.io";
  return `${base.replace(/\/$/, "")}${path}`;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

const ABSENT_CREDENTIAL: PublicAgentCredentialAbsent = { present: false };

/** Public agent credential: present only when owner KYC is currently valid. */
export function toPublicAgentCredential(
  owner: OwnerCredentialSource | null | undefined,
): PublicAgentCredential {
  const publicId = owner?.publicId?.trim();
  if (!owner || !publicId) return ABSENT_CREDENTIAL;
  const expiresAt = asDate(owner.verificationExpiresAt);
  if (!isAccountVerifiedStatus(owner.verificationStatus, expiresAt)) {
    return ABSENT_CREDENTIAL;
  }
  const verifiedAt = asDate(owner.verifiedAt);
  return {
    present: true,
    publicId,
    level: owner.verificationLevel && owner.verificationLevel !== "NONE"
      ? owner.verificationLevel
      : "INDIVIDUAL",
    status: owner.verificationStatus,
    verifiedAt: verifiedAt?.toISOString() ?? null,
    expiresAt: expiresAt?.toISOString() ?? null,
    schemaVersion: 1,
    proofPath: credentialProofPath(publicId),
  };
}

export function withCredentialProofUrl(
  credential: PublicAgentCredential,
  origin?: string,
): PublicAgentCredentialAbsent | (PublicAgentCredentialPresent & { readonly proofUrl: string }) {
  if (!credential.present) return credential;
  return {
    ...credential,
    proofUrl: credentialProofUrl(credential.publicId, origin),
  };
}
