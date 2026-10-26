import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  isInternalBearerSecretConfigured,
  verifyInternalBearer,
} from "@/lib/internal-bearer-auth";
import { runPassportAssessment } from "@/lib/verification/assess";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Continuous monitoring — re-screen ACTIVE passports older than 24h.
 * Auth: Bearer VERIFICATION_CRON_SECRET (or CRON_SECRET fallback for local).
 */
export async function GET(request: Request) {
  const secret =
    process.env.VERIFICATION_CRON_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";

  if (!isInternalBearerSecretConfigured(secret) ||
    !verifyInternalBearer(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const expired = await prisma.agentPassport.updateMany({
    where: {
      status: { in: ["ACTIVE", "PENDING"] },
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });

  const expiredRows = await prisma.agentPassport.findMany({
    where: { status: "EXPIRED", updatedAt: { gte: new Date(now.getTime() - 60_000) } },
    select: { id: true },
    take: 200,
  });
  for (const row of expiredRows) {
    await prisma.verificationEvent.create({
      data: {
        passportId: row.id,
        eventType: "expired",
        detail: { at: now.toISOString() },
      },
    });
  }

  const candidates = await prisma.agentPassport.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ lastScreenedAt: null }, { lastScreenedAt: { lte: staleBefore } }],
    },
    take: 100,
    orderBy: { lastScreenedAt: "asc" },
  });

  const results: Array<{
    passportId: string;
    score: number;
    tier: string;
    status: string;
    hardFail: boolean;
  }> = [];

  for (const passport of candidates) {
    const assessment = await runPassportAssessment({
      passportId: passport.id,
      ownershipProven: true,
      walletAddresses: [passport.ownerWallet],
    });
    results.push({
      passportId: passport.id,
      score: assessment.score,
      tier: assessment.tier,
      status: assessment.status,
      hardFail: assessment.hardFail,
    });
  }

  return NextResponse.json({
    ok: true,
    expiredCount: expired.count,
    screened: results.length,
    results,
    at: now.toISOString(),
  });
}
