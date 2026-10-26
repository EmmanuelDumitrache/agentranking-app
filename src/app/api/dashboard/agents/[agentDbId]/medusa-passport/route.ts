import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import {
  medusaPassportToMetadataEntries,
  medusaPassportVerificationMetadataKeysToClear,
  parseMedusaPassportFromMetadata,
  parseMedusaPassportWalletVerification,
} from "@/lib/medusa/metadata";
import { MEDUSA_METADATA_KEYS } from "@/lib/medusa/config";
import { medusaTierMeetsMinimum } from "@/lib/medusa/tier-map";
import { normalizeMedusaPassportInput } from "@/lib/medusa/api-normalize";
const MEDUSA_DECLARATION_KEYS = [
  MEDUSA_METADATA_KEYS.supported,
  MEDUSA_METADATA_KEYS.useCase,
  MEDUSA_METADATA_KEYS.minTier,
] as const;
export const dynamic = "force-dynamic";
async function upsertAgentMetadata(agentId: number, key: string, value: string) {
  const existing = await prisma.agentMetadata.findFirst({ where: { agentId, key } });
  if (existing) {
    await prisma.agentMetadata.update({ where: { id: existing.id }, data: { value } });
  } else {
    await prisma.agentMetadata.create({ data: { agentId, key, value } });
  }
}
async function deleteAgentMetadata(agentId: number, keys: readonly string[]) {
  if (keys.length === 0) return;
  await prisma.agentMetadata.deleteMany({
    where: { agentId, key: { in: [...keys] } },
  });
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
  const parsed = parseMedusaPassportFromMetadata(metadata);
  const walletVerification = parseMedusaPassportWalletVerification(metadata);
  return NextResponse.json({
    medusaPassport: {
      supported: parsed?.supported ?? false,
      useCase: parsed?.useCase ?? null,
      minTier: parsed?.minTier ?? null,
    },
    walletVerification,
  });
}
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ agentDbId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { agentDbId: agentDbIdParam } = await params;
  const agentDbId = Number.parseInt(agentDbIdParam, 10);
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const body = await request.json();
  const input = normalizeMedusaPassportInput(body?.medusaPassport ?? body);
  if (!input) {
    return NextResponse.json({ error: "Invalid Medusa Passport payload" }, { status: 400 });
  }
  const existingMetadata = await prisma.agentMetadata.findMany({
    where: { agentId: agentDbId },
    select: { key: true, value: true },
  });
  const existingVerification = parseMedusaPassportWalletVerification(existingMetadata);
  await deleteAgentMetadata(agentDbId, MEDUSA_DECLARATION_KEYS);
  if (!input.supported) {
    await deleteAgentMetadata(agentDbId, medusaPassportVerificationMetadataKeysToClear());
  } else {
    const entries = medusaPassportToMetadataEntries(input);
    for (const entry of entries) {
      await upsertAgentMetadata(agentDbId, entry.key, entry.value);
    }
    if (
      existingVerification &&
      input.minTier &&
      !medusaTierMeetsMinimum(existingVerification.tier, input.minTier)
    ) {
      await deleteAgentMetadata(agentDbId, medusaPassportVerificationMetadataKeysToClear());
    }
  }
  await revalidateAgentByDbId(agentDbId);
  const metadata = await prisma.agentMetadata.findMany({
    where: { agentId: agentDbId },
    select: { key: true, value: true },
  });
  const parsed = parseMedusaPassportFromMetadata(metadata);
  const walletVerification = parseMedusaPassportWalletVerification(metadata);
  return NextResponse.json({
    medusaPassport: {
      supported: parsed?.supported ?? false,
      useCase: parsed?.useCase ?? null,
      minTier: parsed?.minTier ?? null,
    },
    walletVerification,
  });
}