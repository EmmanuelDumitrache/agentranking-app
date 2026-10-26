/**
 * Canonical public verification status for AgentRanking agents.
 *
 * Use this in list cards, detail pages, score cards, and anywhere
 * that shows verification state to public readers.
 *
 * Sources checked (in order):
 * 1. Owner account KYC verified (inherited)
 * 2. AgentRanking-native verification (arVerificationStatus === "verified")
 * 3. Public verification workflow (publicVerificationStatus === "verified")
 * 4. Indexed isVerified flag (whitelist / registry import)
 */
import type {
  AccountVerificationLevel,
  AccountVerificationStatus,
} from "@/generated/prisma/client";
import { isAccountVerifiedStatus } from "@/lib/verification/account-verification-types";

export type PublicAgentVerificationStatus = {
  isVerified: boolean;
  label: "Verified" | "Unverified";
  source: "account" | "agentranking" | "public" | "indexed" | null;
};

export type OwnerAccountVerificationFields = {
  publicId?: string | null;
  verificationLevel?: AccountVerificationLevel | null;
  verificationStatus: AccountVerificationStatus;
  verificationExpiresAt?: Date | string | null;
  verifiedAt?: Date | string | null;
};

type AgentLike = {
  arVerificationStatus?: string | null;
  publicVerificationStatus?: string | null;
  isVerified?: boolean | null;
  isPremiumVerified?: boolean | null;
  ownerAccountVerified?: boolean | null;
  ownerAccount?: OwnerAccountVerificationFields | null;
};

export function isOwnerAccountVerified(
  ownerAccount?: OwnerAccountVerificationFields | null,
): boolean {
  if (!ownerAccount) return false;
  const expiresAt = ownerAccount.verificationExpiresAt
    ? ownerAccount.verificationExpiresAt instanceof Date
      ? ownerAccount.verificationExpiresAt
      : new Date(ownerAccount.verificationExpiresAt)
    : null;
  return isAccountVerifiedStatus(ownerAccount.verificationStatus, expiresAt);
}

export function withInheritedAgentVerification<T extends AgentLike>(agent: T) {
  const ownerAccountVerified =
    agent.ownerAccountVerified === true || isOwnerAccountVerified(agent.ownerAccount);

  return {
    ...agent,
    ownerAccountVerified,
    arVerificationStatus: ownerAccountVerified
      ? "verified"
      : (agent.arVerificationStatus ?? null),
    isVerified: ownerAccountVerified || agent.isVerified === true,
    isPremiumVerified: ownerAccountVerified || agent.isPremiumVerified === true,
  };
}

export function getPublicAgentVerificationStatus(
  agent: AgentLike,
): PublicAgentVerificationStatus {
  const resolved = withInheritedAgentVerification(agent);
  if (resolved.ownerAccountVerified) {
    return { isVerified: true, label: "Verified", source: "account" };
  }
  const ar = (resolved.arVerificationStatus ?? "").toLowerCase();
  const pub = (agent.publicVerificationStatus ?? "").toLowerCase();
  const indexed = resolved.isVerified === true;
  if (ar === "verified") {
    return { isVerified: true, label: "Verified", source: "agentranking" };
  }
  if (pub === "verified") {
    return { isVerified: true, label: "Verified", source: "public" };
  }
  if (indexed) {
    return { isVerified: true, label: "Verified", source: "indexed" };
  }
  return { isVerified: false, label: "Unverified", source: null };
}
