import "server-only";

import type { AccountVerificationStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  isAccountVerifiedStatus,
  type AccountVerificationSnapshot,
} from "@/lib/verification/account-verification-types";

export type AgentInheritedVerification = {
  isVerified: boolean;
  level: AccountVerificationSnapshot["level"] | "NONE";
  status: AccountVerificationStatus | "UNVERIFIED";
  publicId: string | null;
};

export async function getAgentVerificationFromOwner(
  agentDbId: number,
): Promise<AgentInheritedVerification> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      ownerAccountId: true,
      ownerAccount: {
        select: {
          publicId: true,
          verificationLevel: true,
          verificationStatus: true,
          verificationExpiresAt: true,
        },
      },
    },
  });

  if (!agent?.ownerAccountId || !agent.ownerAccount) {
    return {
      isVerified: false,
      level: "NONE",
      status: "UNVERIFIED",
      publicId: null,
    };
  }

  const account = agent.ownerAccount;
  const isVerified = isAccountVerifiedStatus(
    account.verificationStatus,
    account.verificationExpiresAt,
  );

  return {
    isVerified,
    level: account.verificationLevel,
    status: account.verificationStatus,
    publicId: account.publicId,
  };
}

export async function getAgentVerificationFromOwnerAccountId(
  ownerAccountId: string,
): Promise<AgentInheritedVerification> {
  const account = await prisma.appAccount.findUnique({
    where: { id: ownerAccountId },
    select: {
      publicId: true,
      verificationLevel: true,
      verificationStatus: true,
      verificationExpiresAt: true,
    },
  });

  if (!account) {
    return {
      isVerified: false,
      level: "NONE",
      status: "UNVERIFIED",
      publicId: null,
    };
  }

  const isVerified = isAccountVerifiedStatus(
    account.verificationStatus,
    account.verificationExpiresAt,
  );

  return {
    isVerified,
    level: account.verificationLevel,
    status: account.verificationStatus,
    publicId: account.publicId,
  };
}
