import {
  HOLDER_POWER_BOOST_PERK,
  HOLDER_STAKE_BADGE_PERK,
  type HolderAgentPerkType,
} from "@/lib/ar-holder-perk-config";
/** Cooldown window (days) before the same wallet can re-apply a perk to the same agent. */
export function holderPerkCooldownDays(perkType: HolderAgentPerkType): number {
  if (perkType === HOLDER_POWER_BOOST_PERK) return 14;
  if (perkType === HOLDER_STAKE_BADGE_PERK) return 7;
  return 7;
}
const COOLDOWN_EPOCH_MS = Date.UTC(2024, 0, 1);
/**
 * One allocation bucket per wallet + perk + agent per cooldown window.
 * Different wallets can boost the same agent in the same window.
 */
export function holderPerkPeriodKey(
  agentDbId: number,
  perkType: HolderAgentPerkType,
  now = new Date(),
): string {
  const days = holderPerkCooldownDays(perkType);
  const windowMs = days * 86_400_000;
  const bucket = Math.floor((now.getTime() - COOLDOWN_EPOCH_MS) / windowMs);
  return `${perkType}:${bucket}:${agentDbId}`;
}