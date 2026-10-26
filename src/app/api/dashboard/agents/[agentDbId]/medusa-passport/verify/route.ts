import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import {
  medusaPassportVerificationMetadataKeysToClear,
  medusaPassportVerificationToMetadataEntries,
  parseMedusaPassportFromMetadata,
  parseMedusaPassportWalletVerification,
} from "@/lib/medusa/metadata";
import { medusaTierMeetsMinimum } from "@/lib/medusa/tier-map";
import {
  isValidMedusaClaimWallet,
  sdkPassportTierToMedusaTier,
  verifyMedusaPassportInput,
} from "@/lib/medusa/verify-server";
export const dynamic = "force-dynamic";
async function upsertAgentMetadata(agentId: number, key: string, value: string) {
  const existing = await prisma.agentMetadata.findFirst({ where: { agentId, key } });
  if (existing) {
    await prisma.agentMetadata.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.agentMetadata.create({ data: { agentId, key, value } });
  }
}
async function deleteVerificationMetadata(agentId: number) {
  await prisma.agentMetadata.deleteMany({
    where: { agentId, key: { in: [...medusaPassportVerificationMetadataKeysToClear()] } },
  });
}
type VerifyBody = {
  passport?: unknown;
  passportJson?: string;
  claimWallet?: string | null;
};
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const passportInput = body.passport ?? body.passportJson;
  if (passportInput == null) {
    return NextResponse.json({ error: "passport or passportJson is required" }, { status: 400 });
  }
  const claimWalletRaw = body.claimWallet?.trim();
  if (claimWalletRaw && !isValidMedusaClaimWallet(claimWalletRaw)) {
    return NextResponse.json({ error: "Invalid Solana claim wallet address" }, { status: 400 });
  }
  const metadata = await prisma.agentMetadata.findMany({
    where: { agentId: agentDbId },
    select: { key: true, value: true },
  });
  const declared = parseMedusaPassportFromMetadata(metadata);
  if (!declared) {
    return NextResponse.json(
      { error: "Enable Medusa Passport support before verifying a wallet passport" },
      { status: 400 },
    );
  }
  try {
    const result = await verifyMedusaPassportInput(passportInput, {
      ...(declared.minTier ? { minTier: declared.minTier } : {}),
    });
    if (!result.valid) {
      return NextResponse.json(
        {
          valid: false,
          errors: result.errors,
          tier: result.tier ?? null,
          tierLabel: result.tierLabel ?? null,
        },
        { status: 400 },
      );
    }
    const verifiedTier = sdkPassportTierToMedusaTier(result.tier);
    if (!verifiedTier) {
      return NextResponse.json({ error: "Passport tier could not be mapped", valid: false }, { status: 400 });
    }
    if (declared.minTier && !medusaTierMeetsMinimum(verifiedTier, declared.minTier)) {
      return NextResponse.json(
        {
          valid: false,
          errors: [`Passport tier ${verifiedTier} does not meet declared minimum ${declared.minTier}`],
          tier: result.tier ?? null,
          tierLabel: result.tierLabel ?? null,
        },
        { status: 400 },
      );
    }
    await deleteVerificationMetadata(agentDbId);
    const verification = {
      verified: true as const,
      tier: verifiedTier,
      verifiedAt: new Date().toISOString(),
      ...(claimWalletRaw ? { claimWallet: claimWalletRaw } : {}),
      ...(result.nullifier ? { nullifier: result.nullifier } : {}),
    };
    for (const entry of medusaPassportVerificationToMetadataEntries(verification)) {
      await upsertAgentMetadata(agentDbId, entry.key, entry.value);
    }
    await revalidateAgentByDbId(agentDbId);
    return NextResponse.json({
      valid: true,
      walletVerification: verification,
      tier: result.tier ?? null,
      tierLabel: result.tierLabel ?? null,
      errors: [],
    });
  } catch (error) {
    const message = Error.isError(error) ? error.message : "Verification failed";
    return NextResponse.json({ error: message, valid: false, errors: [message] }, { status: 400 });
  }
}
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  await deleteVerificationMetadata(agentDbId);
  await revalidateAgentByDbId(agentDbId);
  return NextResponse.json({ cleared: true });
}
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const metadata = await prisma.agentMetadata.findMany({
    where: { agentId: agentDbId },
    select: { key: true, value: true },
  });
  return NextResponse.json({
    walletVerification: parseMedusaPassportWalletVerification(metadata),
  });
}