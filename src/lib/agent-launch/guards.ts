import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { isAgentLaunchNetwork } from "@/lib/agent-launch/network";
import { assessAgentLaunchProductionReadiness } from "@/lib/agent-launch/production-readiness";
export type AgentLaunchGuardResult =
  | { ok: true }
  | { ok: false; reason: string; status: 403 | 404 };
function productionLaunchBlockedReason(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  const report = assessAgentLaunchProductionReadiness();
  return report.ok ? null : report.errors.join("; ");
}
export function assertAgentLaunchServerEnabled(): AgentLaunchGuardResult {
  const config = getAgentLaunchConfig();
  if (!isAgentLaunchNetwork(config.network)) {
    return {
      ok: false,
      reason: `Unsupported AGENT_LAUNCH_NETWORK: ${config.network}`,
      status: 403,
    };
  }
  const productionBlock = productionLaunchBlockedReason();
  if (productionBlock) {
    return {
      ok: false,
      reason: productionBlock,
      status: 403,
    };
  }
  return { ok: true };
}
export function assertAgentLaunchDevMockAllowed(): AgentLaunchGuardResult {
  const base = assertAgentLaunchServerEnabled();
  if (!base.ok) return base;
  if (process.env.NODE_ENV === "production") {
    return {
      ok: false,
      reason: "Dev mock actions are not available in production",
      status: 403,
    };
  }
  return { ok: true };
}
export function agentLaunchApiGuardResponse(
  result: Extract<AgentLaunchGuardResult, { ok: false }>,
): Response {
  return Response.json({ error: result.reason }, { status: result.status });
}
/** Local/devnet-only internal command center — never available in production. */
export function agentLaunchCommandCenterEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return assertAgentLaunchServerEnabled().ok;
}