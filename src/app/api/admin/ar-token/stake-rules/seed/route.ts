import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { HOLDER_TIER_SEED_DEFAULTS } from "@/lib/ar-holder-tier-resolve";
export const dynamic = "force-dynamic";
async function requireAdmin() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
/** POST /api/admin/ar-token/stake-rules/seed — idempotent holder tier rules */
export async function POST() {
  const deny = await requireAdmin();
  if (deny) return deny;
  const created: string[] = [];
  const updated: string[] = [];
  for (const seed of HOLDER_TIER_SEED_DEFAULTS) {
    const existing = await prisma.arStakePerkRule.findFirst({
      where: { perkSlug: seed.slug },
      select: { id: true },
    });
    if (existing) {
      await prisma.arStakePerkRule.update({
        where: { id: existing.id },
        data: {
          name: seed.name,
          description: `Seeded tier gate: ${seed.minLockDays} day minimum lock.`,
          minStakeRaw: seed.minStakeRaw,
          minLockDays: seed.minLockDays,
          priority: seed.priority,
          isActive: true,
        },
      });
      updated.push(seed.slug);
    } else {
      await prisma.arStakePerkRule.create({
        data: {
          name: seed.name,
          description: `Seeded tier gate: ${seed.minLockDays} day minimum lock.`,
          perkSlug: seed.slug,
          minStakeRaw: seed.minStakeRaw,
          minLockDays: seed.minLockDays,
          priority: seed.priority,
          isActive: true,
        },
      });
      created.push(seed.slug);
    }
  }
  return NextResponse.json({ ok: true, created, updated });
}