import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  assertAgentLaunchServerEnabled,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import {
  assertMetaplexLaunchAttemptAccess,
  createMetaplexLaunchAttempt,
  loadMetaplexLaunchAttemptForAgent,
  resolveAgentCustodialWallet,
} from "@/lib/metaplex-launch/attempt-store.server";
import { serializeMetaplexLaunchAttempt } from "@/lib/metaplex-launch/serialize";
import type { MetaplexLaunchInputSnapshot } from "@/lib/metaplex-launch/types";
import {
  normalizeIrysGatewayUrl,
  validateMetaplexLaunchDraft,
} from "@/lib/metaplex-launch/validation";
import { prisma } from "@/lib/db";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
function bodyString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value;
}
function parseDraftFields(raw: unknown): MetaplexLaunchInputSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const tokenName = bodyString(row.tokenName, 128);
  const tokenSymbol = bodyString(row.tokenSymbol, 64);
  const tokenDescription = bodyString(row.tokenDescription, 4_000);
  const tokenImageUrl = bodyString(row.tokenImageUrl, 2_048);
  if (
    tokenName === undefined ||
    tokenSymbol === undefined ||
    tokenDescription === undefined ||
    tokenImageUrl === undefined
  ) {
    return null;
  }
  const website = bodyString(row.website, 2_048);
  const twitter = bodyString(row.twitter, 512);
  const telegram = bodyString(row.telegram, 512);
  const firstBuySol = bodyString(row.firstBuySol, 64);
  if (
    (row.website !== undefined && website === undefined) ||
    (row.twitter !== undefined && twitter === undefined) ||
    (row.telegram !== undefined && telegram === undefined) ||
    (row.firstBuySol !== undefined && firstBuySol === undefined)
  ) {
    return null;
  }
  return {
    tokenName,
    tokenSymbol,
    tokenDescription,
    tokenImageUrl,
    website,
    twitter,
    telegram,
    firstBuySol,
  };
}
function canEditAttempt(attempt: {
  status: string;
  assetAddress: string | null;
  genesisAddress: string | null;
  genesisTxSignatures: string[];
}): boolean {
  if (attempt.status === "DRAFT" || attempt.status === "METADATA_READY") return true;
  if (attempt.status !== "FAILED_RECOVERABLE") return false;
  return !attempt.assetAddress?.trim() && !attempt.genesisAddress?.trim() && attempt.genesisTxSignatures.length === 0;
}
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchServerEnabled();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  const session = await getServerSession(authOptions);
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJsonObject(request, 16 * 1024);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      return jsonNoStore({ error: "Request body is too large." }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError || error instanceof InvalidHttpBodyEncodingError) {
      return jsonNoStore({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    throw error;
  }
  const agentDbId = body.agentDbId;
  if (typeof agentDbId !== "number" || !Number.isSafeInteger(agentDbId) || agentDbId <= 0) {
    return jsonNoStore({ error: "agentDbId must be a positive integer" }, { status: 400 });
  }
  const numericAgentDbId = Number(agentDbId);
  const access = await assertMetaplexLaunchAttemptAccess(session, numericAgentDbId);
  if (!access.ok) return jsonNoStore({ error: "Not authorized" }, { status: access.status });
  const fields = parseDraftFields(body.fields);
  if (!fields) return jsonNoStore({ error: "Invalid launch fields" }, { status: 400 });
  const validationError = validateMetaplexLaunchDraft(fields);
  if (validationError) return jsonNoStore({ error: validationError }, { status: 400 });
  const walletAddress = await resolveAgentCustodialWallet(numericAgentDbId);
  if (!walletAddress) {
    return jsonNoStore(
      { error: "Agent custodial Solana wallet is not available." },
      { status: 503 },
    );
  }
  const normalizedImage = normalizeIrysGatewayUrl(fields.tokenImageUrl) ?? "";
  const agent = await prisma.agent.findUnique({
    where: { id: numericAgentDbId },
    select: {
      name: true,
      description: true,
      image: true,
      metaplexAssetAddress: true,
      metaplexAgentTokenMint: true,
      metaplexTokenBindingStatus: true,
    },
  });
  if (!agent) return jsonNoStore({ error: "Agent not found" }, { status: 404 });
  if (agent.metaplexAgentTokenMint?.trim() || agent.metaplexTokenBindingStatus === "bound") {
    return jsonNoStore(
      { error: "This agent already has a bound Metaplex token." },
      { status: 409 },
    );
  }
  const existingAsset = agent.metaplexAssetAddress?.trim() || null;
  const snapshot: MetaplexLaunchInputSnapshot = {
    ...fields,
    tokenImageUrl: normalizedImage,
    agentName: agent.name,
    agentDescription: agent.description,
    agentImageUrl: agent.image,
    path: existingAsset ? "existing_agent" : "new_agent",
  };
  let attempt = await loadMetaplexLaunchAttemptForAgent(numericAgentDbId);
  if (!attempt) {
    const created = await createMetaplexLaunchAttempt({
      agentDbId: numericAgentDbId,
      userProfileId: access.userProfileId,
      walletAddress,
      inputSnapshot: snapshot,
    });
    attempt = await prisma.metaplexLaunchAttempt.findUniqueOrThrow({ where: { id: created.id } });
  }
  if (!canEditAttempt(attempt)) {
    return jsonNoStore(
      { error: "This launch has already started and its immutable fields can no longer be changed." },
      { status: 409 },
    );
  }
  const resetRecoverable = attempt.status === "FAILED_RECOVERABLE";
  const nextStatus = existingAsset ? "AGENT_REGISTERED" : resetRecoverable ? "DRAFT" : attempt.status;
  const now = new Date();
  const updated = await prisma.metaplexLaunchAttempt.updateMany({
    where: {
      id: attempt.id,
      status: attempt.status,
      OR: [
        { processingLeaseToken: null },
        { processingLeaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      inputSnapshot: snapshot,
      imageUri: normalizedImage || null,
      walletAddress,
      assetAddress: existingAsset,
      status: nextStatus,
      errorCode: null,
      errorMessage: null,
      updatedAt: now,
    },
  });
  if (updated.count !== 1) {
    return jsonNoStore(
      { error: "This launch is currently being processed. Reload it before editing." },
      { status: 409 },
    );
  }
  const fresh = await prisma.metaplexLaunchAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  return jsonNoStore({ attempt: serializeMetaplexLaunchAttempt(fresh) });
}
