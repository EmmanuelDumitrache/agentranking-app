import "server-only";

function parsePositiveBigInt(raw: string | undefined, fallback: bigint): bigint {
  if (!raw?.trim()) return fallback;
  try {
    const value = BigInt(raw.trim());
    if (value <= BigInt(0)) return fallback;
    return value;
  } catch {
    return fallback;
  }
}

function envFlag(name: string, defaultOn = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return defaultOn;
}

export type AgentLaunchWorkerPublicConfig = {
  feeBotPublicKey: string | null;
  minDistributeLamports: bigint;
  feeDistributionEnabled: boolean;
};

export type AgentLaunchWorkerConfig = AgentLaunchWorkerPublicConfig & {
  feeBotPrivateKey: string | null;
};

export function getAgentLaunchWorkerPublicConfig(): AgentLaunchWorkerPublicConfig {
  return {
    feeBotPublicKey: process.env.AGENT_LAUNCH_FEE_BOT_PUBLIC_KEY?.trim() || null,
    minDistributeLamports: parsePositiveBigInt(
      process.env.AGENT_LAUNCH_MIN_DISTRIBUTE_LAMPORTS,
      BigInt(10000),
    ),
    feeDistributionEnabled: envFlag("AGENT_LAUNCH_FEE_DISTRIBUTION_ENABLED", false),
  };
}

export function getAgentLaunchWorkerConfig(): AgentLaunchWorkerConfig {
  return {
    ...getAgentLaunchWorkerPublicConfig(),
    feeBotPrivateKey: process.env.AGENT_LAUNCH_FEE_BOT_PRIVATE_KEY?.trim() || null,
  };
}
