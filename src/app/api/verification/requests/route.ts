import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  ensureMinimalUserProfile,
  hasDashboardIdentity,
} from "@/lib/dashboard/session-profile";
import { normalizeXHandle } from "@/lib/agent-verification";
export const dynamic = "force-dynamic";
function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function normalizeWallet(v: string): string {
  return v.trim().toLowerCase();
}
/** POST /api/verification/requests — submit manual verification application */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardIdentity(session)) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const profile = await ensureMinimalUserProfile(session);
  if (!profile) {
    return NextResponse.json({ error: "Could not resolve user profile" }, { status: 400 });
  }
  const body = (await request.json()) as {
    agentDbId?: number;
    xHandle?: string;
    website?: string;
    tokenAddress?: string;
    proofNotes?: string;
    walletAddress?: string;
  };
  const agentDbId =
    typeof body.agentDbId === "number" && Number.isFinite(body.agentDbId)
      ? Math.floor(body.agentDbId)
      : NaN;
  if (!Number.isFinite(agentDbId) || agentDbId <= 0) {
    return NextResponse.json({ error: "agentDbId is required" }, { status: 400 });
  }
  const walletAddress = normalizeWallet(clean(body.walletAddress, 80));
  if (!/^0x[a-f0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: "Valid EVM wallet address required" }, { status: 400 });
  }
  const sessionWallet = session?.user?.walletAddress?.trim().toLowerCase() ?? "";
  const profileWallet = profile.walletAddress?.trim().toLowerCase() ?? "";
  if (sessionWallet && sessionWallet !== walletAddress) {
    return NextResponse.json(
      { error: "walletAddress must match your connected wallet" },
      { status: 403 },
    );
  }
  if (!sessionWallet && profileWallet && profileWallet !== walletAddress) {
    return NextResponse.json(
      { error: "walletAddress must match your profile wallet" },
      { status: 403 },
    );
  }
  const xHandle = normalizeXHandle(clean(body.xHandle, 32));
  if (!xHandle) {
    return NextResponse.json({ error: "Valid X handle required (e.g. @myagent)" }, { status: 400 });
  }
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      name: true,
      agentId: true,
      chainId: true,
      isPremiumVerified: true,
      publicVerificationStatus: true,
    },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  const website = clean(body.website, 500);
  const tokenAddress = clean(body.tokenAddress, 80);
  const proofNotes = clean(body.proofNotes, 4000);
  const submission = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`verification-request:${agent.id}`}, 0))`;
    const openExisting = await tx.agentVerificationRequest.findFirst({
      where: {
        agentId: agent.id,
        verificationStatus: { in: ["submitted", "in_review"] },
      },
      select: { id: true, verificationStatus: true },
    });
    if (openExisting) return { kind: "existing" as const, existing: openExisting };
    const row = await tx.agentVerificationRequest.create({
      data: {
        agentId: agent.id,
        agentName: agent.name,
        xHandle,
        walletAddress,
        website,
        tokenAddress,
        proofNotes,
        userProfileId: profile.id,
        verificationStatus: "submitted",
        paymentStatus: "pending",
      },
      select: {
        id: true,
        verificationStatus: true,
        submittedAt: true,
      },
    });
    await tx.agent.update({
      where: { id: agent.id },
      data: { publicVerificationStatus: "submitted" },
    });
    return { kind: "created" as const, row };
  });
  if (submission.kind === "existing") {
    return NextResponse.json(
      {
        error: "This agent already has an open verification request",
        requestId: submission.existing.id,
        verificationStatus: submission.existing.verificationStatus,
      },
      { status: 409 },
    );
  }
  const row = submission.row;
  return NextResponse.json({
    ok: true,
    request: {
      id: row.id,
      verificationStatus: row.verificationStatus,
      publicVerificationStatus: "submitted",
      submittedAt: row.submittedAt.toISOString(),
      agent: {
        id: agent.id,
        agentId: agent.agentId,
        chainId: agent.chainId,
        isPremiumVerified: agent.isPremiumVerified,
      },
    },
  });
}
