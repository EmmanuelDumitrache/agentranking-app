import type { AgentLaunch, AgentLaunchEvent, AgentLaunchFeeDistribution } from "@/generated/prisma/client";
function serializeBigInt(value: bigint | null | undefined): string | null {
  if (value == null) return null;
  return value.toString();
}
export function serializeAgentLaunch(launch: AgentLaunch) {
  return {
    ...launch,
    launchKind: launch.launchKind ?? "agentranking",
    launchLifecycleStatus: launch.launchLifecycleStatus ?? "unknown",
    marketSource: launch.marketSource ?? "unavailable",
    profileTags: launch.profileTags ?? [],
    creationFeeLamports: serializeBigInt(launch.creationFeeLamports),
    totalFeesDistributedLamports: launch.totalFeesDistributedLamports.toString(),
    totalArFeesLamports: launch.totalArFeesLamports.toString(),
    totalCreatorFeesLamports: launch.totalCreatorFeesLamports.toString(),
    lastDistributionAt: launch.lastDistributionAt?.toISOString() ?? null,
    createdAt: launch.createdAt.toISOString(),
    updatedAt: launch.updatedAt.toISOString(),
  };
}
export function serializeAgentLaunchEvent(event: AgentLaunchEvent) {
  return {
    ...event,
    createdAt: event.createdAt.toISOString(),
  };
}
export function serializeAgentLaunchDistribution(distribution: AgentLaunchFeeDistribution) {
  return {
    ...distribution,
    totalAmount: distribution.totalAmount.toString(),
    arAmount: distribution.arAmount.toString(),
    creatorAmount: distribution.creatorAmount.toString(),
    createdAt: distribution.createdAt.toISOString(),
  };
}