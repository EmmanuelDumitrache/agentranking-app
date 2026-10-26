import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runPassportAssessment } from "@/lib/verification/assess";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const passportId = String((body as Record<string, unknown>).passportId ?? "").trim();
  if (!passportId) {
    return NextResponse.json({ error: "passportId is required" }, { status: 400 });
  }

  const passport = await prisma.agentPassport.findUnique({
    where: { id: passportId },
    include: { ownershipProofs: { orderBy: { verifiedAt: "desc" }, take: 1 } },
  });
  if (!passport) {
    return NextResponse.json({ error: "Passport not found" }, { status: 404 });
  }

  const assessment = await runPassportAssessment({
    passportId,
    ownershipProven: passport.ownershipProofs.length > 0,
    walletAddresses: [passport.ownerWallet],
  });

  const refreshed = await prisma.agentPassport.findUnique({ where: { id: passportId } });
  return NextResponse.json({ passport: refreshed, assessment });
}
