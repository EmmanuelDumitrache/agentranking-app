import "server-only";
import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { loadAgentCustodialKeypair } from "@/lib/custodial-wallet/sign-launch";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import type { MetaplexLaunchAttemptStatus } from "@/lib/metaplex-launch/constants";
import { assertMetaplexLaunchStatusAdvance } from "@/lib/metaplex-launch/status-machine";
export class MetaplexAttemptStateConflictError extends Error {
  readonly attemptId: string;
  readonly expectedStatus: string;
  readonly actualStatus: string;
  constructor(attemptId: string, expectedStatus: string, actualStatus: string) {
    super(`Metaplex launch attempt state changed from ${expectedStatus} to ${actualStatus}.`);
    this.name = "MetaplexAttemptStateConflictError";
    this.attemptId = attemptId;
    this.expectedStatus = expectedStatus;
    this.actualStatus = actualStatus;
  }
}
export async function assertMetaplexLaunchAttemptAccess(
  session: Session | null,
  agentDbId: number,
): Promise<{ ok: true; userProfileId: number | null } | { ok: false; status: 401 | 403 | 404 }> {
  if (!session?.user) {
    return { ok: false, status: 401 };
  }
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) {
    return { ok: false, status: access.status === 401 ? 401 : 403 };
  }
  const profile = await getDashboardUserProfile(session);
  return { ok: true, userProfileId: profile?.id ?? null };
}
export async function loadMetaplexLaunchAttemptForAgent(agentDbId: number) {
  return prisma.metaplexLaunchAttempt.findFirst({
    where: {
      agentDbId,
      status: { notIn: ["COMPLETE", "FAILED_FINAL"] },
    },
    orderBy: { updatedAt: "desc" },
  });
}
export async function loadMetaplexLaunchAttemptById(id: string) {
  return prisma.metaplexLaunchAttempt.findUnique({ where: { id } });
}
export async function resolveAgentCustodialWallet(agentDbId: number): Promise<string | null> {
  const keypair = await loadAgentCustodialKeypair(agentDbId);
  return keypair?.publicKey.toBase58() ?? null;
}
export async function createMetaplexLaunchAttempt(input: {
  agentDbId: number;
  userProfileId: number | null;
  walletAddress: string;
  inputSnapshot?: Record<string, unknown>;
  imageUri?: string | null;
  publicCreatorWallet?: string | null;
}): Promise<{ id: string; publicAttributionId: string }> {
  if (!Number.isSafeInteger(input.agentDbId) || input.agentDbId <= 0) {
    throw new Error("Invalid agent database id");
  }
  const config = getAgentLaunchConfig();
  return prisma.$transaction(async (tx) => {
    // One non-terminal attempt may exist per agent. The transaction-scoped
    // advisory lock closes the find/create race across all web processes even
    // though the lifecycle predicate cannot be represented as a Prisma unique.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(3, ${input.agentDbId})`;
    const existing = await tx.metaplexLaunchAttempt.findFirst({
      where: {
        agentDbId: input.agentDbId,
        status: { notIn: ["COMPLETE", "FAILED_FINAL"] },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        publicAttributionId: true,
        publicCreatorWallet: true,
      },
    });
    const publicCreatorWallet = input.publicCreatorWallet?.trim() || null;
    if (existing) {
      if (
        publicCreatorWallet &&
        existing.publicCreatorWallet &&
        existing.publicCreatorWallet !== publicCreatorWallet
      ) {
        throw new Error("This agent already has a launch owned by another public wallet.");
      }
      if (publicCreatorWallet && !existing.publicCreatorWallet) {
        return tx.metaplexLaunchAttempt.update({
          where: { id: existing.id },
          data: { publicCreatorWallet },
          select: { id: true, publicAttributionId: true },
        });
      }
      return {
        id: existing.id,
        publicAttributionId: existing.publicAttributionId,
      };
    }
    return tx.metaplexLaunchAttempt.create({
      data: {
        publicAttributionId: randomUUID(),
        agentDbId: input.agentDbId,
        userProfileId: input.userProfileId,
        publicCreatorWallet,
        walletAddress: input.walletAddress.trim(),
        network: config.network,
        status: "DRAFT",
        inputSnapshot: (input.inputSnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
        imageUri: input.imageUri?.trim() || null,
        arAgentId: input.agentDbId,
      },
      select: { id: true, publicAttributionId: true },
    });
  });
}
export async function updateMetaplexLaunchAttemptStatus(
  id: string,
  from: MetaplexLaunchAttemptStatus,
  to: MetaplexLaunchAttemptStatus,
  patch?: Omit<
    Prisma.MetaplexLaunchAttemptUncheckedUpdateInput,
    "status" | "updatedAt"
  >,
) {
  assertMetaplexLaunchStatusAdvance(from, to);
  // Keep the native first-signature projection in sync with the full array.
  const derived = { ...patch };
  if (Array.isArray(patch?.genesisTxSignatures)) {
    derived.genesisTxSignature =
      patch.genesisTxSignatures.find((sig) => typeof sig === "string" && sig.trim().length > 0) ?? null;
  }
  const updated = await prisma.metaplexLaunchAttempt.updateMany({
    where: { id, status: from },
    data: {
      status: to,
      ...derived,
      updatedAt: new Date(),
    },
  });
  if (updated.count !== 1) {
    const current = await prisma.metaplexLaunchAttempt.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current) throw new Error(`Metaplex launch attempt not found: ${id}`);
    throw new MetaplexAttemptStateConflictError(id, from, current.status);
  }
  return prisma.metaplexLaunchAttempt.findUniqueOrThrow({ where: { id } });
}
export async function patchMetaplexLaunchAttempt(
  id: string,
  data: Prisma.MetaplexLaunchAttemptUncheckedUpdateInput,
) {
  return prisma.metaplexLaunchAttempt.update({
    where: { id },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });
}
export async function resetMetaplexLaunchAttemptDraftImage(input: {
  id: string;
  expectedStatus: "DRAFT" | "METADATA_READY";
  imageUri: string;
  inputSnapshot: Prisma.InputJsonValue;
}) {
  const updated = await prisma.metaplexLaunchAttempt.updateMany({
    where: {
      id: input.id,
      status: input.expectedStatus,
      assetAddress: null,
    },
    data: {
      // METADATA_READY is reversible only while no asset transaction has been
      // built. Replacing the image invalidates the uploaded metadata document,
      // so reset both the stage and metadata URI in one compare-and-set write.
      status: "DRAFT",
      imageUri: input.imageUri,
      metadataUri: null,
      inputSnapshot: input.inputSnapshot,
      errorCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    },
  });
  if (updated.count !== 1) {
    const current = await prisma.metaplexLaunchAttempt.findUnique({
      where: { id: input.id },
      select: { status: true },
    });
    if (!current) throw new Error(`Metaplex launch attempt not found: ${input.id}`);
    throw new MetaplexAttemptStateConflictError(
      input.id,
      input.expectedStatus,
      current.status,
    );
  }
  return prisma.metaplexLaunchAttempt.findUniqueOrThrow({ where: { id: input.id } });
}
export async function markMetaplexLaunchAttemptRecoverableFailure(
  id: string,
  errorCode: string,
  errorMessage: string,
) {
  const updated = await prisma.metaplexLaunchAttempt.updateMany({
    where: { id, status: { notIn: ["COMPLETE", "FAILED_FINAL"] } },
    data: {
      // Preserve the exact durable stage. Collapsing AGENT_SUBMITTED,
      // GENESIS_SUBMITTED, and the other evidence-bearing states into a generic
      // failure status destroys the information needed to decide whether an
      // irreversible transaction may already exist on-chain.
      errorCode,
      errorMessage,
      retryCount: { increment: 1 },
      updatedAt: new Date(),
    },
  });
  if (updated.count !== 1) {
    const current = await prisma.metaplexLaunchAttempt.findUnique({ where: { id } });
    if (!current) throw new Error(`Metaplex launch attempt not found: ${id}`);
    return current;
  }
  return prisma.metaplexLaunchAttempt.findUniqueOrThrow({ where: { id } });
}
export async function assertAttemptMatchesSession(
  attempt: { agentDbId: number; walletAddress: string },
  session: Session | null,
  expectedWallet: string,
): Promise<{ ok: true } | { ok: false; status: 401 | 403 | 404 }> {
  const access = await assertMetaplexLaunchAttemptAccess(session, attempt.agentDbId);
  if (!access.ok) return access;
  if (attempt.walletAddress.trim() !== expectedWallet.trim()) {
    return { ok: false, status: 403 };
  }
  return { ok: true };
}
