import "server-only";

import { revalidatePath } from "next/cache";
import type {
  AccountVerificationLevel,
  AccountVerificationStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import { invalidatePublicAgentProfileCaches } from "@/lib/invalidate-public-statistics";
import {
  isAccountVerifiedStatus,
  toPublicCredential,
  type AccountVerificationSnapshot,
} from "@/lib/verification/account-verification-types";
import {
  isKycDevBypassActive,
  isPersonaEmbeddedAvailable,
  isVerificationEnabled,
  getPersonaEnvironmentId,
  getKycProviderId,
} from "@/lib/verification/config";
import { generateAccountPublicId } from "@/lib/verification/public-id";
import { getKycProvider } from "@/lib/verification/providers";
import { PersonaKycProvider, PersonaResumeConflictError } from "@/lib/verification/providers/kyc/persona";
import { anchorAccountVerificationOnRegistry } from "@/lib/verification/registry-anchor";
import type { KycSessionStatus } from "@/lib/verification/providers/types";

export type VerificationSessionPayload = {
  sessionId: string;
  url: string;
  provider: string;
  embedded?: {
    inquiryId: string;
    environmentId: string;
    sessionToken?: string | null;
  };
};

export class VerificationAlreadyCompleteError extends Error {
  readonly code = "already_verified" as const;

  constructor(message = "Your account is already verified.") {
    super(message);
    this.name = "VerificationAlreadyCompleteError";
  }
}

function mapKycStatusToAccountStatus(
  status: KycSessionStatus,
  needsReview?: boolean,
): AccountVerificationStatus {
  if (needsReview) return "NEEDS_REVIEW";
  switch (status) {
    case "approved":
      return "VERIFIED";
    case "rejected":
      return "DECLINED";
    case "expired":
      return "EXPIRED";
    case "needs_review":
      return "NEEDS_REVIEW";
    case "pending":
    default:
      return "PENDING";
  }
}

function mapLevelForStatus(
  status: AccountVerificationStatus,
): AccountVerificationLevel {
  if (status === "VERIFIED") return "INDIVIDUAL";
  return "NONE";
}

async function ensureAccountPublicId(appAccountId: string): Promise<string> {
  const account = await prisma.appAccount.findUnique({
    where: { id: appAccountId },
    select: { publicId: true },
  });
  if (!account) throw new Error("Account not found");
  if (account.publicId) return account.publicId;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const publicId = generateAccountPublicId();
    try {
      const updated = await prisma.appAccount.update({
        where: { id: appAccountId },
        data: { publicId },
        select: { publicId: true },
      });
      return updated.publicId;
    } catch {
      // collision — retry
    }
  }
  throw new Error("Failed to allocate public account id");
}

function buildSnapshot(account: {
  id: string;
  publicId: string;
  verificationLevel: AccountVerificationLevel;
  verificationStatus: AccountVerificationStatus;
  verifiedAt: Date | null;
  verificationExpiresAt: Date | null;
  verificationRevokedAt: Date | null;
}): AccountVerificationSnapshot {
  const isVerified = isAccountVerifiedStatus(
    account.verificationStatus,
    account.verificationExpiresAt,
  );
  return {
    appAccountId: account.id,
    publicId: account.publicId,
    level: account.verificationLevel,
    status: account.verificationStatus,
    verifiedAt: account.verifiedAt,
    expiresAt: account.verificationExpiresAt,
    revokedAt: account.verificationRevokedAt,
    isVerified,
    canIssueCards: isVerified && isVerificationEnabled(),
    credential: toPublicCredential({
      publicId: account.publicId,
      level: account.verificationLevel,
      status: account.verificationStatus,
      verifiedAt: account.verifiedAt,
      expiresAt: account.verificationExpiresAt,
    }),
  };
}

export async function getAccountVerification(
  appAccountId: string,
): Promise<AccountVerificationSnapshot | null> {
  const account = await prisma.appAccount.findUnique({
    where: { id: appAccountId },
    select: {
      id: true,
      publicId: true,
      verificationLevel: true,
      verificationStatus: true,
      verifiedAt: true,
      verificationExpiresAt: true,
      verificationRevokedAt: true,
    },
  });
  if (!account) return null;

  const publicId = account.publicId ?? (await ensureAccountPublicId(appAccountId));
  return buildSnapshot({ ...account, publicId });
}

export async function isAccountVerified(appAccountId: string): Promise<boolean> {
  const snapshot = await getAccountVerification(appAccountId);
  if (!snapshot) return false;
  return snapshot.isVerified;
}

export async function assertAccountVerifiedForCardIssuance(
  appAccountId: string,
): Promise<void> {
  if (isKycDevBypassActive()) return;
  const verified = await isAccountVerified(appAccountId);
  if (!verified) {
    throw new Error(
      "Account verification required — complete AgentRanking verification to issue cards.",
    );
  }
}

export async function createVerificationSession(params: {
  appAccountId: string;
  returnUrl: string;
}): Promise<VerificationSessionPayload> {
  const snapshot = await getAccountVerification(params.appAccountId);
  if (snapshot?.isVerified) {
    throw new VerificationAlreadyCompleteError();
  }

  await ensureAccountPublicId(params.appAccountId);
  const provider = getKycProvider();

  const existingPending = await prisma.accountVerification.findFirst({
    where: {
      appAccountId: params.appAccountId,
      status: "PENDING",
      provider: provider.name,
      providerSessionId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { providerSessionId: true },
  });

  if (existingPending?.providerSessionId) {
    const sessionId = existingPending.providerSessionId;
    const remote = await provider.getStatus(sessionId);

    if (remote.status === "approved") {
      await applyProviderVerificationStatus({
        appAccountId: params.appAccountId,
        provider: provider.name,
        providerReference: remote.providerRef,
        providerSessionId: sessionId,
        status: "approved",
        verifiedAt: remote.completedAt ?? new Date(),
      });
      throw new VerificationAlreadyCompleteError();
    }

    if (remote.status === "pending") {
      let sessionToken: string | null = null;
      if (provider instanceof PersonaKycProvider) {
        try {
          sessionToken = await provider.createResumeSessionToken(sessionId);
        } catch (err) {
          const latest = await provider.getStatus(sessionId);
          if (latest.status === "approved") {
            await applyProviderVerificationStatus({
              appAccountId: params.appAccountId,
              provider: provider.name,
              providerReference: latest.providerRef,
              providerSessionId: sessionId,
              status: "approved",
              verifiedAt: latest.completedAt ?? new Date(),
            });
            throw new VerificationAlreadyCompleteError();
          }
          if (err instanceof PersonaResumeConflictError) {
            throw new VerificationAlreadyCompleteError();
          }
          throw err;
        }
      }

      const url = (() => {
        if (provider.name === "persona") {
          return `https://withpersona.com/verify?inquiry-id=${encodeURIComponent(sessionId)}`;
        }
        const nextUrl = new URL(params.returnUrl);
        nextUrl.searchParams.set("sessionId", sessionId);
        nextUrl.searchParams.set("provider", provider.name);
        return nextUrl.toString();
      })();

      return buildVerificationSessionPayload({
        providerName: provider.name,
        sessionId,
        url,
        sessionToken,
      });
    }

    // Stale pending row — inquiry expired/declined in Persona; start fresh below.
  }

  const session = await provider.createSession({
    referenceId: params.appAccountId,
    callbackUrl: params.returnUrl,
  });

  await prisma.appAccount.update({
    where: { id: params.appAccountId },
    data: {
      verificationStatus: "PENDING",
      verificationLevel: "NONE",
    },
  });

  await prisma.accountVerification.create({
    data: {
      appAccountId: params.appAccountId,
      provider: provider.name,
      providerReference: session.sessionId,
      providerSessionId: session.sessionId,
      level: "INDIVIDUAL",
      status: "PENDING",
    },
  });

  return buildVerificationSessionPayload({
    providerName: provider.name,
    sessionId: session.sessionId,
    url: session.url,
    sessionToken: null,
  });
}

function buildVerificationSessionPayload(params: {
  providerName: string;
  sessionId: string;
  url: string;
  sessionToken: string | null;
}): VerificationSessionPayload {
  const environmentId = getPersonaEnvironmentId();
  const embedded =
    params.providerName === "persona" && isPersonaEmbeddedAvailable()
      ? {
          inquiryId: params.sessionId,
          environmentId,
          sessionToken: params.sessionToken,
        }
      : undefined;

  return {
    sessionId: params.sessionId,
    url: params.url,
    provider: params.providerName,
    embedded,
  };
}

export async function applyProviderVerificationStatus(params: {
  appAccountId: string;
  provider: string;
  providerReference: string;
  providerSessionId?: string;
  status: KycSessionStatus;
  needsReview?: boolean;
  webhookEventId?: string;
  verifiedAt?: Date;
}): Promise<AccountVerificationSnapshot | null> {
  if (params.webhookEventId) {
    const existing = await prisma.accountVerification.findUnique({
      where: { webhookEventId: params.webhookEventId },
    });
    if (existing) {
      return getAccountVerification(params.appAccountId);
    }
  }

  const accountStatus = mapKycStatusToAccountStatus(
    params.status,
    params.needsReview,
  );
  const level = mapLevelForStatus(accountStatus);
  const now = new Date();
  const verifiedAt =
    accountStatus === "VERIFIED" ? (params.verifiedAt ?? now) : null;

  await prisma.$transaction(async (tx) => {
    await tx.accountVerification.create({
      data: {
        appAccountId: params.appAccountId,
        provider: params.provider,
        providerReference: params.providerReference,
        providerSessionId: params.providerSessionId,
        level,
        status: accountStatus,
        verifiedAt,
        webhookEventId: params.webhookEventId ?? null,
      },
    });

    await tx.appAccount.update({
      where: { id: params.appAccountId },
      data: {
        verificationStatus: accountStatus,
        verificationLevel: level,
        verifiedAt:
          accountStatus === "VERIFIED" ? verifiedAt : null,
        verificationRevokedAt:
          accountStatus === "REVOKED" ? now : null,
      },
    });
  });

  await invalidateVerificationCaches(params.appAccountId);

  if (accountStatus === "VERIFIED") {
    const account = await prisma.appAccount.findUnique({
      where: { id: params.appAccountId },
      select: { publicId: true, verificationExpiresAt: true },
    });
    if (account?.publicId) {
      const latestVerification = await prisma.accountVerification.findFirst({
        where: {
          appAccountId: params.appAccountId,
          status: "VERIFIED",
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      void anchorAccountVerificationOnRegistry({
        appAccountId: params.appAccountId,
        publicId: account.publicId,
        level,
        verifiedAt: verifiedAt ?? now,
        expiresAt: account.verificationExpiresAt,
        accountVerificationId: latestVerification?.id,
      }).catch((err) => {
        console.warn("[verification] 8004 registry anchor failed:", err);
      });
    }
  }

  return getAccountVerification(params.appAccountId);
}

export async function devSetAccountVerificationState(
  appAccountId: string,
  params: {
    level: AccountVerificationLevel;
    kycComplete: boolean;
  },
): Promise<AccountVerificationSnapshot | null> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("KYC dev bypass is not enabled");
  }

  await ensureAccountPublicId(appAccountId);
  const now = new Date();

  if (!params.kycComplete) {
    await prisma.$transaction(async (tx) => {
      await tx.accountVerification.create({
        data: {
          appAccountId,
          provider: "dev-bypass",
          providerReference: `dev_reset_${appAccountId}_${now.getTime()}`,
          level: "NONE",
          status: "UNVERIFIED",
        },
      });

      await tx.appAccount.update({
        where: { id: appAccountId },
        data: {
          verificationStatus: "UNVERIFIED",
          verificationLevel: "NONE",
          verifiedAt: null,
          verificationRevokedAt: null,
        },
      });
    });
  } else {
    const level =
      params.level === "NONE" || params.level === "INDIVIDUAL"
        ? "INDIVIDUAL"
        : "BUSINESS";

    await prisma.$transaction(async (tx) => {
      await tx.accountVerification.create({
        data: {
          appAccountId,
          provider: "dev-bypass",
          providerReference: `dev_${appAccountId}_${now.getTime()}`,
          level,
          status: "VERIFIED",
          verifiedAt: now,
        },
      });

      await tx.appAccount.update({
        where: { id: appAccountId },
        data: {
          verificationStatus: "VERIFIED",
          verificationLevel: level,
          verifiedAt: now,
          verificationRevokedAt: null,
        },
      });
    });
  }

  await invalidateVerificationCaches(appAccountId);
  return getAccountVerification(appAccountId);
}

export async function syncAccountVerificationFromProvider(
  appAccountId: string,
): Promise<AccountVerificationSnapshot | null> {
  const latest = await prisma.accountVerification.findFirst({
    where: {
      appAccountId,
      providerSessionId: { not: null },
      status: { in: ["PENDING", "NEEDS_REVIEW"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      provider: true,
      providerSessionId: true,
      status: true,
    },
  });

  if (!latest?.providerSessionId) {
    return getAccountVerification(appAccountId);
  }

  const provider = getKycProvider();
  if (provider.name !== latest.provider) {
    return getAccountVerification(appAccountId);
  }

  try {
    const remote = await provider.getStatus(latest.providerSessionId);
    const needsReview = remote.status === "needs_review";
    if (remote.status === "pending" || needsReview) {
      return getAccountVerification(appAccountId);
    }

    return applyProviderVerificationStatus({
      appAccountId,
      provider: provider.name,
      providerReference: remote.providerRef,
      providerSessionId: latest.providerSessionId,
      status: remote.status,
      needsReview: false,
      verifiedAt: remote.completedAt,
    });
  } catch {
    return getAccountVerification(appAccountId);
  }
}

export async function completeMockVerificationSession(
  appAccountId: string,
): Promise<AccountVerificationSnapshot | null> {
  if (getKycProviderId() !== "mock") {
    throw new Error("Mock verification completion is only available in mock KYC mode");
  }

  const pending = await prisma.accountVerification.findFirst({
    where: {
      appAccountId,
      provider: "mock",
      status: "PENDING",
      providerSessionId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { providerSessionId: true },
  });

  const sessionId =
    pending?.providerSessionId ?? `mock_complete_${appAccountId}_${Date.now()}`;

  return applyProviderVerificationStatus({
    appAccountId,
    provider: "mock",
    providerReference: sessionId,
    providerSessionId: sessionId,
    status: "approved",
    verifiedAt: new Date(),
  });
}

export async function revokeAccountVerification(
  appAccountId: string,
  reason: string,
): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.accountVerification.create({
      data: {
        appAccountId,
        provider: "system",
        providerReference: `revoke_${now.getTime()}`,
        level: "NONE",
        status: "REVOKED",
        revokedAt: now,
      },
    });

    await tx.appAccount.update({
      where: { id: appAccountId },
      data: {
        verificationStatus: "REVOKED",
        verificationLevel: "NONE",
        verificationRevokedAt: now,
      },
    });
  });

  await invalidateVerificationCaches(appAccountId);
  void reason;
}

async function invalidateVerificationCaches(appAccountId: string): Promise<void> {
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/verify");
  revalidatePath("/dashboard/credentials");
  revalidatePath("/dashboard/card");

  const agents = await prisma.agent.findMany({
    where: { ownerAccountId: appAccountId, isActive: true },
    select: { id: true },
  });

  await Promise.all(agents.map((agent) => revalidateAgentByDbId(agent.id)));

  await invalidatePublicAgentProfileCaches();
}

export function getPaymentEligibility(snapshot: AccountVerificationSnapshot | null) {
  const verified = snapshot?.isVerified ?? false;
  return {
    canUseBasicPayments: true,
    canIssueCards: verified && isVerificationEnabled(),
    reasons: verified
      ? []
      : ["Complete AgentRanking account verification to unlock card issuance."],
  };
}
