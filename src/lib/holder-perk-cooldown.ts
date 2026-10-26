import type { PrismaClient } from "@/generated/prisma/client";
import {
  HOLDER_POWER_BOOST_PERK,
  HOLDER_STAKE_BADGE_PERK,
  type HolderAgentPerkType,
} from "@/lib/ar-holder-perk-config";
import { holderPerkCooldownDays } from "@/lib/holder-perk-period-key";
type CooldownDb = Pick<PrismaClient, "arHolderAgentPerk">;
/** True when wallet already has an active perk on this agent inside the cooldown window. */
export async function hasActiveHolderPerkCooldown(
  db: CooldownDb,
  wallet: string,
  agentDbId: number,
  perkType: HolderAgentPerkType,
  now = new Date(),
): Promise<boolean> {
  const days = holderPerkCooldownDays(perkType);
  const since = new Date(now.getTime() - days * 86_400_000);
  const row = await db.arHolderAgentPerk.findFirst({
    where: {
      wallet,
      agentId: agentDbId,
      perkType,
      status: "active",
      createdAt: { gte: since },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  return row != null;
}
export function holderPerkCooldownErrorMessage(
  perkType: HolderAgentPerkType,
  agentName?: string | null,
): string {
  const days = holderPerkCooldownDays(perkType);
  const target = agentName ? ` on ${agentName}` : " on this agent";
  if (perkType === HOLDER_POWER_BOOST_PERK) {
    return `Reputation votes from staking already applied${target} in the last ${days} days. You can boost a different agent or wait for the cooldown.`;
  }
  if (perkType === HOLDER_STAKE_BADGE_PERK) {
    return `Stake Endorsement Badge already applied${target} in the last ${days} days.`;
  }
  return `This perk was already used${target} recently. Try again in ${days} days.`;
}