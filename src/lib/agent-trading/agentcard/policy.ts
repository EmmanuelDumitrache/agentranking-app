import { getAgentCardConfig } from "./config";

const agentDailySpendCents = new Map<string, number>();

function utcDayKey(agentDbId: number): string {
  const now = new Date();
  return `${agentDbId}:${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`;
}

export function validateAgentCardAmountDollars(amountDollars: number): {
  ok: boolean;
  amountCents: number;
  roundedDollars: number;
  message?: string;
} {
  if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
    return {
      ok: false,
      amountCents: 0,
      roundedDollars: 0,
      message: "Amount must be greater than zero.",
    };
  }

  const config = getAgentCardConfig();
  const roundedDollars = Math.ceil(amountDollars);
  if (roundedDollars > config.maxCardAmountDollars) {
    return {
      ok: false,
      amountCents: 0,
      roundedDollars: 0,
      message: `Amount exceeds maximum card limit of $${config.maxCardAmountDollars}.`,
    };
  }

  return {
    ok: true,
    amountCents: roundedDollars * 100,
    roundedDollars,
  };
}

export function checkArDailyCap(agentDbId: number, amountCents: number): {
  ok: boolean;
  message?: string;
} {
  const config = getAgentCardConfig();
  if (!config.arDailyCapUsd) return { ok: true };

  const capCents = Math.round(config.arDailyCapUsd * 100);
  const key = utcDayKey(agentDbId);
  const spent = agentDailySpendCents.get(key) ?? 0;
  if (spent + amountCents > capCents) {
    return {
      ok: false,
      message: `AgentRanking daily AgentCard cap of $${config.arDailyCapUsd} would be exceeded.`,
    };
  }
  return { ok: true };
}

export function recordArDailySpend(agentDbId: number, amountCents: number): void {
  const config = getAgentCardConfig();
  if (!config.arDailyCapUsd) return;
  const key = utcDayKey(agentDbId);
  agentDailySpendCents.set(key, (agentDailySpendCents.get(key) ?? 0) + amountCents);
}
