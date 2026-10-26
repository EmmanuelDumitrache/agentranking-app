import type { SerializedAgentLaunch } from "@/components/agent-launch/types";
/** Indexed launches are finished — default `/launch` must not reopen the editable wizard. */
export function isLaunchIndexed(
  launch: Pick<SerializedAgentLaunch, "launchStatus"> | null,
): boolean {
  return launch?.launchStatus === "indexed";
}
/** On-chain setup is done or fee routing is live — token fields must stay read-only. */
export function isLaunchCreationLocked(
  launch: Pick<SerializedAgentLaunch, "launchStatus" | "feeSharingStatus"> | null,
): boolean {
  if (!launch) return false;
  return launch.launchStatus === "indexed" || launch.feeSharingStatus === "active";
}
