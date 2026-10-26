import { randomUUIDv7 } from "@/lib/uuid-v7";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { readAdminHolderAllocations } from "@/lib/admin/operations/ar-token.server";
import { getHolderTierById, HOLDER_POWER_BOOST_PERK, isHolderAgentPerkType } from "@/lib/ar-holder-perk-config";
import { applyDaoVotesAdminChange } from "@/lib/admin-dao-votes-apply";
import { normalizeStakeWallet } from "@/lib/ar-holder-tier-resolve";
import { holderPerkPeriodKey } from "@/lib/holder-perk-period-key";
export const dynamic = "force-dynamic";
async function requireAdmin() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
function perkExpiresAt(minLockDays: number, now = new Date()): Date {
  const days = Math.max(1, minLockDays);
  return new Date(now.getTime() + days * 86_400_000);
}
/** GET /api/admin/ar-token/holder-allocations?wallet= */
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(
      await readAdminHolderAllocations(req.nextUrl.searchParams.get("wallet")),
    );
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/admin/ar-token/holder-allocations error:", error);
    return NextResponse.json({ error: "Failed to load holder allocations" }, { status: 500 });
  }
}
/** POST — manual grant */
export async function POST(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const wallet = normalizeStakeWallet(typeof body.wallet === "string" ? body.wallet : "");
  const agentDbId = Number(body.agentDbId);
  const perkType = typeof body.perkType === "string" ? body.perkType : "";
  const tierId = typeof body.tierId === "string" ? body.tierId : "validator";
  if (!wallet) return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  if (!Number.isInteger(agentDbId) || agentDbId <= 0) {
    return NextResponse.json({ error: "agentDbId is required" }, { status: 400 });
  }
  if (!isHolderAgentPerkType(perkType)) {
    return NextResponse.json({ error: "Unsupported perk type" }, { status: 400 });
  }
  const tier = getHolderTierById(tierId);
  if (!tier) return NextResponse.json({ error: "Unknown tier" }, { status: 400 });
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: { id: true, name: true },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const boostUnits = perkType === HOLDER_POWER_BOOST_PERK ? tier.boostUnits : 0;
  const expiresAt = perkExpiresAt(tier.minLockDays);
  const pKey = holderPerkPeriodKey(agentDbId, perkType);
  const row = await prisma.arHolderAgentPerk.upsert({
    where: {
      wallet_perkType_periodKey: {
        wallet,
        perkType,
        periodKey: pKey,
      },
    },
    create: {
      id: randomUUIDv7(),
      wallet,
      agentId: agentDbId,
      perkType,
      tierId: tier.id,
      boostUnits,
      status: "active",
      periodKey: pKey,
      expiresAt,
    },
    update: {
      agentId: agentDbId,
      tierId: tier.id,
      boostUnits,
      status: "active",
      expiresAt,
    },
  });
  if (perkType === HOLDER_POWER_BOOST_PERK) {
    await applyDaoVotesAdminChange(prisma, [agentDbId]).catch(console.error);
  }
  return NextResponse.json({ ok: true, allocation: row });
}
/** DELETE — revoke by id */
export async function DELETE(req: NextRequest) {
  const deny = await requireAdmin();
  if (deny) return deny;
  const id = req.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const existing = await prisma.arHolderAgentPerk.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.arHolderAgentPerk.update({
    where: { id },
    data: { status: "revoked" },
  });
  if (existing.perkType === HOLDER_POWER_BOOST_PERK) {
    await applyDaoVotesAdminChange(prisma, [existing.agentId]).catch(console.error);
  }
  return NextResponse.json({ ok: true });
}
