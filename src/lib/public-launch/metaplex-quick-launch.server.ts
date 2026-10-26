import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  AGENTRANKING_LISTING_SOURCE,
  createNativeAgentRankingAgent,
} from "@/lib/dashboard/native-agent";
import { AGENTRANKING_NATIVE_CHAIN_ID } from "@/lib/chain-constants";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import {
  assertAgentLaunchServerEnabled,
} from "@/lib/agent-launch/guards";
import { getAgentWalletSolBalanceLamports } from "@/lib/metaplex-launch/umi-factory.server";
import {
  createMetaplexLaunchAttempt,
  loadMetaplexLaunchAttemptById,
  loadMetaplexLaunchAttemptForAgent,
  resolveAgentCustodialWallet,
} from "@/lib/metaplex-launch/attempt-store.server";
import { serializeMetaplexLaunchAttempt } from "@/lib/metaplex-launch/serialize";
import type { MetaplexLaunchInputSnapshot } from "@/lib/metaplex-launch/types";
import {
  normalizeIrysGatewayUrl,
  validateMetaplexFirstBuySol,
  validateMetaplexTokenDescription,
  validateMetaplexTokenName,
  validateMetaplexTokenSymbol,
} from "@/lib/metaplex-launch/validation";
import { metaplexProductEnabled } from "@/lib/metaplex/config";
import {
  buildMetaplexFundingQuote,
  isRecoverableMetaplexAttemptStatus,
  PUBLIC_METAPLEX_MIN_SOL_LAMPORTS,
  type MetaplexFundingQuote,
  type MetaplexFundingStage,
} from "@/lib/public-launch/metaplex-funding-quote.server";
import {
  getLaunchWalletSession,
  type LaunchWalletSessionData,
} from "@/lib/launch-wallet-session/session";
import { normalizeLaunchWallet } from "@/lib/launch-wallet-session/wallet-match";
import { withValkeyLease } from "@/lib/valkey";
export { PUBLIC_METAPLEX_MIN_SOL_LAMPORTS };
export type { MetaplexFundingQuote, MetaplexFundingStage };
const CREATOR_META_KEY = "publicMetaplexCreatorWallet";
const PUBLIC_PREPARATION_LEASE_TTL_MS = 2 * 60_000;
const ORPHAN_AGENT_LOOKBACK_MS = 24 * 60 * 60_000;
export class PublicMetaplexPreparationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicMetaplexPreparationInputError";
  }
}
export class PublicMetaplexPreparationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicMetaplexPreparationStateError";
  }
}
function publicPreparationLeaseKey(creatorWallet: string): string {
  const digest = createHash("sha256").update(creatorWallet.trim()).digest("hex");
  return `lease:public-metaplex-prepare:${digest}`;
}
function assertPreparationLease(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Public Metaplex preparation lease was lost");
}
export type PublicMetaplexPrepared = {
  attempt: ReturnType<typeof serializeMetaplexLaunchAttempt>;
  agentDbId: number;
  custodialWallet: string;
  balanceLamports: number;
  minLamports: number;
  shortfallLamports: number;
  funded: boolean;
  stage: MetaplexFundingStage;
  fundingMessage: string;
};
export type PublicMetaplexOpenAttempt = {
  attempt: ReturnType<typeof serializeMetaplexLaunchAttempt>;
  agentDbId: number;
  custodialWallet: string;
  balanceLamports: number;
  minLamports: number;
  shortfallLamports: number;
  funded: boolean;
  stage: MetaplexFundingStage;
  fundingMessage: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImageUrl: string | null;
};
function snapshotCreatorWallet(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const raw = (snapshot as { creatorWallet?: unknown }).creatorWallet;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return normalizeLaunchWallet("solana", raw.trim());
}
export async function requirePublicMetaplexSolanaSession(): Promise<
  | { ok: true; session: LaunchWalletSessionData; creatorWallet: string }
  | { ok: false; status: 401 | 403; error: string }
> {
  const session = await getLaunchWalletSession();
  if (!session) {
    return { ok: false, status: 401, error: "Wallet session required. Connect Phantom and sign in." };
  }
  if (session.chain !== "solana") {
    return { ok: false, status: 403, error: "Metaplex Genesis requires a Solana wallet session." };
  }
  const creatorWallet = normalizeLaunchWallet("solana", session.wallet);
  if (!creatorWallet) {
    return { ok: false, status: 403, error: "Invalid Solana wallet session." };
  }
  return { ok: true, session, creatorWallet };
}
export function assertPublicMetaplexLaunchEnabled():
  | { ok: true }
  | { ok: false; status: 403; error: string } {
  if (!metaplexProductEnabled()) {
    return {
      ok: false,
      status: 403,
      error: "Metaplex is disabled. Set METAPLEX_ENABLED=1 on the server.",
    };
  }
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) {
    return { ok: false, status: 403, error: guard.reason };
  }
  return { ok: true };
}
export async function assertPublicOwnsMetaplexAttempt(
  attemptId: string,
  creatorWallet: string,
): Promise<
  | { ok: true; attempt: NonNullable<Awaited<ReturnType<typeof loadMetaplexLaunchAttemptById>>> }
  | { ok: false; status: 403 | 404; error: string }
> {
  const attempt = await loadMetaplexLaunchAttemptById(attemptId);
  if (!attempt) {
    return { ok: false, status: 404, error: "Launch attempt not found" };
  }
  const owner =
    normalizeLaunchWallet("solana", attempt.publicCreatorWallet ?? "") ??
    snapshotCreatorWallet(attempt.inputSnapshot);
  if (!owner || owner !== creatorWallet) {
    return { ok: false, status: 403, error: "Not authorized for this Metaplex launch." };
  }
  return { ok: true, attempt };
}
type PublicLaunchProfile = { id: number; walletAddress: string | null; solanaWallet: string | null };
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
async function findProfileForSolanaWallet(creatorWallet: string): Promise<PublicLaunchProfile | null> {
  return prisma.userProfile.findFirst({
    where: {
      OR: [
        { solanaWallet: creatorWallet },
        { walletAddress: creatorWallet },
      ],
    },
    select: { id: true, walletAddress: true, solanaWallet: true },
  });
}
async function ensureProfileForSolanaWallet(creatorWallet: string) {
  let profile = await findProfileForSolanaWallet(creatorWallet);
  if (!profile) {
    try {
      profile = await prisma.userProfile.create({
        data: {
          solanaWallet: creatorWallet,
          walletAddress: creatorWallet,
          displayName: `Wallet ${creatorWallet.slice(0, 4)}…${creatorWallet.slice(-4)}`,
          bio: "",
          avatarUrl: "",
        },
        select: { id: true, walletAddress: true, solanaWallet: true },
      });
    } catch (error) {
      // Concurrent preparations for the same wallet can race on either unique
      // wallet column. Re-read the winner instead of surfacing a spurious 500.
      if (!isUniqueConstraintError(error)) throw error;
      profile = await findProfileForSolanaWallet(creatorWallet);
      if (!profile) throw error;
    }
  }
  if (!profile) {
    throw new Error("Could not create or resolve the launch profile.");
  }
  if (!profile.solanaWallet) {
    try {
      profile = await prisma.userProfile.update({
        where: { id: profile.id },
        data: { solanaWallet: creatorWallet },
        select: { id: true, walletAddress: true, solanaWallet: true },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await findProfileForSolanaWallet(creatorWallet);
      if (!winner) throw error;
      profile = winner;
    }
  }
  if (!profile) {
    throw new Error("Could not resolve the launch profile after wallet linking.");
  }
  return {
    id: profile.id,
    walletAddress: profile.walletAddress ?? creatorWallet,
    solanaWallet: profile.solanaWallet ?? creatorWallet,
  };
}
async function findOpenPublicAttemptForCreator(creatorWallet: string) {
  const attempt = await prisma.metaplexLaunchAttempt.findFirst({
    where: {
      status: { notIn: ["COMPLETE", "FAILED_FINAL"] },
      publicCreatorWallet: creatorWallet,
    },
    orderBy: { updatedAt: "desc" },
  });
  return attempt && isRecoverableMetaplexAttemptStatus(attempt.status) ? attempt : null;
}
async function findOrphanPublicLaunchAgentForCreator(creatorWallet: string): Promise<number | null> {
  const candidates = await prisma.agentMetadata.findMany({
    where: {
      key: CREATOR_META_KEY,
      value: creatorWallet,
      agent: {
        chainId: AGENTRANKING_NATIVE_CHAIN_ID,
        listingRegistrySource: AGENTRANKING_LISTING_SOURCE,
        metaplexAgentTokenMint: null,
        metaplexTokenBindingStatus: { not: "bound" },
        createdAt: { gte: new Date(Date.now() - ORPHAN_AGENT_LOOKBACK_MS) },
      },
    },
    orderBy: { id: "desc" },
    take: 10,
    select: { agentId: true },
  });
  if (candidates.length === 0) return null;
  const candidateIds = [...new Set(candidates.map((row) => row.agentId))];
  const attempted = await prisma.metaplexLaunchAttempt.findMany({
    where: { agentDbId: { in: candidateIds } },
    select: { agentDbId: true },
  });
  const attemptedIds = new Set(attempted.map((row) => row.agentDbId));
  return candidateIds.find((id) => !attemptedIds.has(id)) ?? null;
}
function snapshotTokenFields(snapshot: unknown): {
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImageUrl: string | null;
} {
  if (!snapshot || typeof snapshot !== "object") {
    return { tokenName: null, tokenSymbol: null, tokenImageUrl: null };
  }
  const raw = snapshot as {
    tokenName?: unknown;
    tokenSymbol?: unknown;
    tokenImageUrl?: unknown;
  };
  return {
    tokenName: typeof raw.tokenName === "string" ? raw.tokenName : null,
    tokenSymbol: typeof raw.tokenSymbol === "string" ? raw.tokenSymbol : null,
    tokenImageUrl: typeof raw.tokenImageUrl === "string" ? raw.tokenImageUrl : null,
  };
}
function buildPreparedResponse(input: {
  attempt: Awaited<ReturnType<typeof findOpenPublicAttemptForCreator>>;
  agentDbId: number;
  custodialWallet: string;
  balanceLamports: number;
}): PublicMetaplexPrepared {
  if (!input.attempt) {
    throw new Error("Missing Metaplex launch attempt.");
  }
  const quote = buildMetaplexFundingQuote({
    attempt: input.attempt,
    balanceLamports: input.balanceLamports,
  });
  return {
    attempt: serializeMetaplexLaunchAttempt(input.attempt),
    agentDbId: input.agentDbId,
    custodialWallet: input.custodialWallet,
    balanceLamports: quote.balanceLamports,
    minLamports: quote.minLamports,
    shortfallLamports: quote.shortfallLamports,
    funded: quote.funded,
    stage: quote.stage,
    fundingMessage: quote.fundingMessage,
  };
}
export async function loadOpenPublicMetaplexAttempt(
  creatorWallet: string,
  attemptId?: string | null,
): Promise<PublicMetaplexOpenAttempt | null> {
  const requestedId = attemptId?.trim() || null;
  const attempt = requestedId
    ? await loadMetaplexLaunchAttemptById(requestedId)
    : await findOpenPublicAttemptForCreator(creatorWallet);
  if (!attempt || !isRecoverableMetaplexAttemptStatus(attempt.status)) return null;
  if (requestedId) {
    const owner =
      normalizeLaunchWallet("solana", attempt.publicCreatorWallet ?? "") ??
      snapshotCreatorWallet(attempt.inputSnapshot);
    if (!owner || owner !== creatorWallet) return null;
  }
  let balanceLamports = 0;
  try {
    balanceLamports = await getAgentWalletSolBalanceLamports(attempt.walletAddress);
  } catch {
    // Preserve the recoverable launch state when the balance RPC is temporarily unavailable.
  }
  const quote = buildMetaplexFundingQuote({ attempt, balanceLamports });
  const fields = snapshotTokenFields(attempt.inputSnapshot);
  return {
    attempt: serializeMetaplexLaunchAttempt(attempt),
    agentDbId: attempt.agentDbId,
    custodialWallet: attempt.walletAddress,
    balanceLamports: quote.balanceLamports,
    minLamports: quote.minLamports,
    shortfallLamports: quote.shortfallLamports,
    funded: quote.funded,
    stage: quote.stage,
    fundingMessage: quote.fundingMessage,
    tokenName: fields.tokenName,
    tokenSymbol: fields.tokenSymbol,
    tokenImageUrl: fields.tokenImageUrl ?? attempt.imageUri,
  };
}
async function updateEditablePublicAttempt(input: {
  attempt: NonNullable<Awaited<ReturnType<typeof findOpenPublicAttemptForCreator>>>;
  snapshot: MetaplexLaunchInputSnapshot & { creatorWallet: string };
  imageUri: string | null;
  walletAddress: string;
  network: string;
  creatorWallet: string;
}) {
  if (input.attempt.status !== "DRAFT" && input.attempt.status !== "METADATA_READY") {
    throw new PublicMetaplexPreparationStateError(
      "This launch has already started. Reload the existing launch instead of changing its draft fields.",
    );
  }
  const now = new Date();
  const updated = await prisma.metaplexLaunchAttempt.updateMany({
    where: {
      id: input.attempt.id,
      status: input.attempt.status,
      AND: [
        {
          OR: [
            { publicCreatorWallet: null },
            { publicCreatorWallet: input.creatorWallet },
          ],
        },
        {
          OR: [
            { processingLeaseToken: null },
            { processingLeaseExpiresAt: null },
            { processingLeaseExpiresAt: { lte: now } },
          ],
        },
      ],
    },
    data: {
      inputSnapshot: input.snapshot,
      publicCreatorWallet: input.creatorWallet,
      imageUri: input.imageUri,
      walletAddress: input.walletAddress,
      network: input.network,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
    },
  });
  if (updated.count !== 1) {
    throw new PublicMetaplexPreparationStateError(
      "This launch is currently being processed. Reload it before editing.",
    );
  }
  return prisma.metaplexLaunchAttempt.findUniqueOrThrow({
    where: { id: input.attempt.id },
  });
}
export async function preparePublicMetaplexQuickLaunch(input: {
  creatorWallet: string;
  fields: {
    tokenName: string;
    tokenSymbol: string;
    tokenDescription: string;
    tokenImageUrl: string;
    website?: string;
    twitter?: string;
    telegram?: string;
    firstBuySol?: string;
  };
}): Promise<PublicMetaplexPrepared> {
  const enabled = assertPublicMetaplexLaunchEnabled();
  if (!enabled.ok) {
    throw new Error(enabled.error);
  }
  const draftFields: MetaplexLaunchInputSnapshot = {
    tokenName: input.fields.tokenName.trim(),
    tokenSymbol: input.fields.tokenSymbol.trim().toUpperCase(),
    tokenDescription: input.fields.tokenDescription.trim(),
    tokenImageUrl: input.fields.tokenImageUrl.trim(),
    website: input.fields.website?.trim() || undefined,
    twitter: input.fields.twitter?.trim() || undefined,
    telegram: input.fields.telegram?.trim() || undefined,
    firstBuySol: input.fields.firstBuySol?.trim() || "0",
    agentName: input.fields.tokenName.trim(),
    agentDescription: input.fields.tokenDescription.trim(),
    agentImageUrl: input.fields.tokenImageUrl.trim(),
    path: "new_agent",
  };
  // Preview image may be a public upload URL until Irys upload after funding.
  const fieldError =
    validateMetaplexTokenName(draftFields.tokenName) ??
    validateMetaplexTokenSymbol(draftFields.tokenSymbol) ??
    validateMetaplexTokenDescription(draftFields.tokenDescription) ??
    validateMetaplexFirstBuySol(draftFields.firstBuySol);
  if (fieldError) throw new PublicMetaplexPreparationInputError(fieldError);
  if (!input.fields.tokenImageUrl.trim()) {
    throw new PublicMetaplexPreparationInputError("Upload a token logo first.");
  }
  const prepared = await withValkeyLease(
    {
      key: publicPreparationLeaseKey(input.creatorWallet),
      ttlMs: PUBLIC_PREPARATION_LEASE_TTL_MS,
      renewEveryMs: 30_000,
    },
    async (leaseSignal) => {
      assertPreparationLease(leaseSignal);
      const profile = await ensureProfileForSolanaWallet(input.creatorWallet);
      const config = getAgentLaunchConfig();
      let attempt = await findOpenPublicAttemptForCreator(input.creatorWallet);
      let agentDbId = attempt?.agentDbId ?? null;
      if (!agentDbId) {
        agentDbId = await findOrphanPublicLaunchAgentForCreator(input.creatorWallet);
      }
      if (!agentDbId) {
        const agent = await createNativeAgentRankingAgent(profile, {
          name: draftFields.tokenName.slice(0, 80),
          description: draftFields.tokenDescription.slice(0, 2000),
          image: draftFields.tokenImageUrl,
          website: draftFields.website,
          twitter: draftFields.twitter,
          telegram: draftFields.telegram,
          tags: ["metaplex", "genesis", "public-launch"],
          metadata: [{ key: CREATOR_META_KEY, value: input.creatorWallet }],
        });
        assertPreparationLease(leaseSignal);
        agentDbId = agent.id;
      }
      assertPreparationLease(leaseSignal);
      const custodialWallet = await resolveAgentCustodialWallet(agentDbId);
      if (!custodialWallet) {
        throw new Error("Could not provision the agent Solana wallet for Metaplex launch.");
      }
      const normalizedImage = normalizeIrysGatewayUrl(draftFields.tokenImageUrl) ?? "";
      const snapshot: MetaplexLaunchInputSnapshot & { creatorWallet: string } = {
        ...draftFields,
        tokenImageUrl: normalizedImage || draftFields.tokenImageUrl,
        creatorWallet: input.creatorWallet,
      };
      if (attempt) {
        attempt = await updateEditablePublicAttempt({
          attempt,
          snapshot,
          imageUri: normalizedImage || null,
          walletAddress: custodialWallet,
          network: config.network,
          creatorWallet: input.creatorWallet,
        });
      } else {
        const existingForAgent = await loadMetaplexLaunchAttemptForAgent(agentDbId);
        if (existingForAgent) {
          attempt = await updateEditablePublicAttempt({
            attempt: existingForAgent,
            snapshot,
            imageUri: normalizedImage || null,
            walletAddress: custodialWallet,
            network: config.network,
            creatorWallet: input.creatorWallet,
          });
        } else {
          const created = await createMetaplexLaunchAttempt({
            agentDbId,
            userProfileId: profile.id,
            walletAddress: custodialWallet,
            inputSnapshot: snapshot,
            imageUri: normalizedImage || null,
            publicCreatorWallet: input.creatorWallet,
          });
          attempt = await prisma.metaplexLaunchAttempt.findUniqueOrThrow({
            where: { id: created.id },
          });
        }
      }
      assertPreparationLease(leaseSignal);
      return { attempt, agentDbId, custodialWallet };
    },
  );
  const balanceLamports = await getAgentWalletSolBalanceLamports(prepared.custodialWallet);
  return buildPreparedResponse({
    attempt: prepared.attempt,
    agentDbId: prepared.agentDbId,
    custodialWallet: prepared.custodialWallet,
    balanceLamports,
  });
}
export async function getPublicMetaplexFundingStatus(input: {
  attemptId: string;
  creatorWallet: string;
}): Promise<{
  custodialWallet: string;
  balanceLamports: number;
  minLamports: number;
  shortfallLamports: number;
  funded: boolean;
  stage: MetaplexFundingStage;
  fundingMessage: string;
  hasIrysImage: boolean;
}> {
  const ownership = await assertPublicOwnsMetaplexAttempt(input.attemptId, input.creatorWallet);
  if (!ownership.ok) {
    throw new Error(ownership.error);
  }
  const custodialWallet = ownership.attempt.walletAddress;
  const balanceLamports = await getAgentWalletSolBalanceLamports(custodialWallet);
  const quote = buildMetaplexFundingQuote({
    attempt: ownership.attempt,
    balanceLamports,
  });
  const imageUri = ownership.attempt.imageUri?.trim() || "";
  return {
    custodialWallet,
    balanceLamports: quote.balanceLamports,
    minLamports: quote.minLamports,
    shortfallLamports: quote.shortfallLamports,
    funded: quote.funded,
    stage: quote.stage,
    fundingMessage: quote.fundingMessage,
    hasIrysImage: Boolean(normalizeIrysGatewayUrl(imageUri)),
  };
}
