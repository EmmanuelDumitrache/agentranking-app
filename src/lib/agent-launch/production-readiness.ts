import "server-only";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import {
  AGENTRANKING_CREATOR_SHARE_BPS,
  AGENTRANKING_PLATFORM_SHARE_BPS,
  getAgentLaunchEconomics,
  validateAgentLaunchEconomics,
} from "@/lib/agent-launch/fees";
import {
  isAgentLaunchNetwork,
  parseAgentLaunchNetwork,
  validateAgentLaunchRpcEnv,
} from "@/lib/agent-launch/network";
export type AgentLaunchReadinessReport = {
  ok: boolean;
  network: string;
  errors: string[];
  warnings: string[];
};
/** Production-safe launch config validation (startup + API guards). */
export function assessAgentLaunchProductionReadiness(): AgentLaunchReadinessReport {
  const config = getAgentLaunchConfig();
  const economics = getAgentLaunchEconomics();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isAgentLaunchNetwork(config.network)) {
    errors.push(`AGENT_LAUNCH_NETWORK must be devnet or mainnet-beta (got ${config.network})`);
  }
  let network = parseAgentLaunchNetwork("devnet");
  try {
    network = parseAgentLaunchNetwork(config.network);
  } catch (error) {
    errors.push(Error.isError(error) ? error.message : String(error));
  }
  const rpcError = validateAgentLaunchRpcEnv(network);
  if (rpcError) errors.push(rpcError);
  errors.push(
    ...validateAgentLaunchEconomics(economics, { requireFeeRecipient: true }),
  );
  if (economics.creatorShareBps !== AGENTRANKING_CREATOR_SHARE_BPS) {
    warnings.push(
      `AGENTRANKING_CREATOR_SHARE_BPS is ${economics.creatorShareBps} (expected ${AGENTRANKING_CREATOR_SHARE_BPS} for MVP)`,
    );
  }
  if (economics.platformShareBps !== AGENTRANKING_PLATFORM_SHARE_BPS) {
    warnings.push(
      `AGENTRANKING_PLATFORM_SHARE_BPS is ${economics.platformShareBps} (expected ${AGENTRANKING_PLATFORM_SHARE_BPS} for MVP)`,
    );
  }
  if (economics.tokenLaunchPlatformFeeLamports > BigInt(0)) {
    warnings.push("TOKEN_LAUNCH_PLATFORM_FEE_SOL is non-zero");
  }
  return {
    ok: errors.length === 0,
    network: config.network,
    errors,
    warnings,
  };
}
