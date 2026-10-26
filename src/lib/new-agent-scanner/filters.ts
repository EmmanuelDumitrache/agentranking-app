
import { getAgentListStatusBadges } from "@/lib/agent-list-status-badges";


import type { NewAgentScannerAgent } from "@/lib/new-agent-scanner/types";
export function countCapabilities(agent: NewAgentScannerAgent): number {
  return getAgentListStatusBadges(agent, { variant: "home" }).length;
}