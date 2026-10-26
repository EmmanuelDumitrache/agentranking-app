import "server-only";

export type AgentTradingConfig = {
  jupiterBaseUrl: string;
  jupiterApiKey: string | null;
  platformFeeBps: number;
  referralAccount: string | null;
  defaultSlippageBps: number;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Resolve Jupiter + trading settings from AgentRanking env (not apebot keys). */
export function getAgentTradingConfig(): AgentTradingConfig {
  const jupiterApiKey = process.env.JUPITER_API_KEY?.trim() || null;
  const jupiterBaseUrl =
    process.env.JUPITER_API_BASE_URL?.trim() ||
    (jupiterApiKey ? "https://api.jup.ag" : "https://lite-api.jup.ag");

  return {
    jupiterBaseUrl,
    jupiterApiKey,
    platformFeeBps: parsePositiveInt(process.env.JUPITER_FEE_BPS, 0),
    referralAccount: process.env.JUPITER_REFERRAL_ACCOUNT?.trim() || null,
    defaultSlippageBps: parsePositiveInt(
      process.env.AGENT_TRADE_SLIPPAGE_BPS,
      100,
    ),
  };
}
