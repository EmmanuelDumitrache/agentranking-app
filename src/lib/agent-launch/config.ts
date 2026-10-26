import { BPS_TOTAL } from "@/lib/agent-launch/constants";
import {
  formatFeeShareLabel,
  formatSolLamportsLabel,
  getAgentLaunchEconomics,
  shouldRequireFeeRecipientInProduction,
  validateAgentLaunchEconomics,
} from "@/lib/agent-launch/fees";
import {
  isAgentLaunchNetwork,
  parseAgentLaunchNetwork,
  validateAgentLaunchRpcEnv,
} from "@/lib/agent-launch/network";
export type AgentLaunchConfig = {
  network: string;
  treasury: string | null;
  creationFeeLamports: bigint;
  initialBuyLamports: bigint;
  creatorShareBps: number;
  arShareBps: number;
};
export function getAgentLaunchConfig(): AgentLaunchConfig {
  const economics = getAgentLaunchEconomics();
  const networkRaw = process.env.AGENT_LAUNCH_NETWORK?.trim() || "devnet";
  let network = networkRaw;
  try {
    network = parseAgentLaunchNetwork(networkRaw);
  } catch {
    network = networkRaw;
  }
  return {
    network,
    treasury: economics.feeRecipientWallet,
    creationFeeLamports: economics.tokenLaunchPlatformFeeLamports,
    initialBuyLamports: economics.initialBuyLamports,
    creatorShareBps: economics.creatorShareBps,
    arShareBps: economics.platformShareBps,
  };
}
export function validateAgentLaunchConfig(config: AgentLaunchConfig): string[] {
  const errors = validateAgentLaunchEconomics(
    {
      creatorShareBps: config.creatorShareBps,
      platformShareBps: config.arShareBps,
      agentCreationFeeLamports: BigInt(0),
      tokenLaunchPlatformFeeLamports: config.creationFeeLamports,
      initialBuyLamports: config.initialBuyLamports,
      feeRecipientWallet: config.treasury ?? "",
    },
    { requireFeeRecipient: shouldRequireFeeRecipientInProduction() },
  );
  if (config.creatorShareBps + config.arShareBps !== BPS_TOTAL) {
    errors.push(
      `Creator + platform share BPS must equal ${BPS_TOTAL}`,
    );
  }
  if (!isAgentLaunchNetwork(config.network)) {
    errors.push("AGENT_LAUNCH_NETWORK must be devnet or mainnet-beta");
  } else {
    const rpcError = validateAgentLaunchRpcEnv(parseAgentLaunchNetwork(config.network));
    if (rpcError) errors.push(rpcError);
  }
  if (shouldRequireFeeRecipientInProduction() && !config.treasury) {
    errors.push("AGENTRANKING_FEE_RECIPIENT_WALLET is required for production/mainnet launch");
  }
  return errors;
}
/** Client-safe fee display fields (read from server env, passed as props). */
export type AgentLaunchFeeDisplayConfig = {
  creatorShareBps: number;
  arShareBps: number;
  /** Null when platform fee is zero — do not show as "launch fee". */
  platformFeeSol: string | null;
  /** Null when no bundled initial buy is configured. */
  initialBuySol: string | null;
  feeShareLabel: string;
  treasury: string | null;
  network: string;
};
export function getAgentLaunchFeeDisplayConfig(): AgentLaunchFeeDisplayConfig {
  const config = getAgentLaunchConfig();
  const platformFeeSol = formatSolLamportsLabel(config.creationFeeLamports);
  const initialBuySol = formatSolLamportsLabel(config.initialBuyLamports);
  return {
    creatorShareBps: config.creatorShareBps,
    arShareBps: config.arShareBps,
    platformFeeSol,
    initialBuySol,
    feeShareLabel: formatFeeShareLabel(config.creatorShareBps, config.arShareBps),
    treasury: config.treasury,
    network: config.network,
  };
}
export { formatLaunchNetworkLabel } from "@/lib/agent-launch/network-label";
