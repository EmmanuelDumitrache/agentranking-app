import { createHash } from "node:crypto";
import type {
  AccountVerificationLevel,
  AccountVerificationStatus,
} from "@/generated/prisma/client";

export type VerificationAnchorPayload = {
  v: 1;
  publicId: string;
  level: AccountVerificationLevel;
  verifiedAt: string;
  appAccountId: string;
};

/** Public claim hashed for machines — no internal account ids. */
export type PublicCredentialClaim = {
  v: 1;
  publicId: string;
  level: AccountVerificationLevel;
  status: AccountVerificationStatus;
  verifiedAt: string;
  schemaVersion: 1;
};

export function buildVerificationAnchorPayload(params: {
  publicId: string;
  level: AccountVerificationLevel;
  verifiedAt: Date;
  appAccountId: string;
}): VerificationAnchorPayload {
  return {
    v: 1,
    publicId: params.publicId,
    level: params.level,
    verifiedAt: params.verifiedAt.toISOString(),
    appAccountId: params.appAccountId,
  };
}

export function hashVerificationAnchorPayload(
  payload: VerificationAnchorPayload,
): { hex: string; bytes: number[] } {
  const canonical = JSON.stringify(payload);
  const digest = createHash("sha256").update(canonical).digest();
  return { hex: digest.toString("hex"), bytes: [...digest] };
}

export function buildPublicCredentialClaim(params: {
  publicId: string;
  level: AccountVerificationLevel;
  status: AccountVerificationStatus;
  verifiedAt: Date;
}): PublicCredentialClaim {
  return {
    v: 1,
    publicId: params.publicId,
    level: params.level,
    status: params.status,
    verifiedAt: params.verifiedAt.toISOString(),
    schemaVersion: 1,
  };
}

export function hashPublicCredentialClaim(
  claim: PublicCredentialClaim,
): { hex: string; bytes: number[] } {
  const canonical = JSON.stringify(claim);
  const digest = createHash("sha256").update(canonical).digest();
  return { hex: digest.toString("hex"), bytes: [...digest] };
}
