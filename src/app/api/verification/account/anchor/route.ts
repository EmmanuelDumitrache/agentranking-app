import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { prisma } from "@/lib/db";
import { getAccountVerification } from "@/lib/verification/account-verification-service";
import {
  anchorAccountVerificationOnRegistry,
  getRegistryAnchorStatus,
} from "@/lib/verification/registry-anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  const status = await getRegistryAnchorStatus(auth.appAccountId);
  return NextResponse.json(status);
}

export async function POST() {
  const session = await getServerSession(authOptions);
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return auth.response;

  const snapshot = await getAccountVerification(auth.appAccountId);
  if (!snapshot?.isVerified) {
    return NextResponse.json(
      { error: "Account must be verified before on-chain anchoring" },
      { status: 400 },
    );
  }

  const account = await prisma.appAccount.findUnique({
    where: { id: auth.appAccountId },
    select: { verificationExpiresAt: true },
  });

  const result = await anchorAccountVerificationOnRegistry({
    appAccountId: auth.appAccountId,
    publicId: snapshot.publicId,
    level: snapshot.level,
    verifiedAt: snapshot.verifiedAt ?? new Date(),
    expiresAt: account?.verificationExpiresAt ?? null,
  });

  if (result.status === "error") {
    return NextResponse.json({ error: result.message, result }, { status: 502 });
  }

  return NextResponse.json({ result });
}
