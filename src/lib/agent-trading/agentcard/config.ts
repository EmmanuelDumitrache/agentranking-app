import { readAgentCardTokenFromCliConfig } from "./token";

export interface AgentCardConfig {
  apiToken: string | null;
  apiBaseUrl: string;
  maxCardAmountDollars: number;
  arDailyCapUsd: number | null;
  enabled: boolean;
  tokenSource: "env" | "cli-config" | null;
}

function readOptional(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

function parsePositiveNumber(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAgentCardConfig(): AgentCardConfig {
  const envToken = readOptional("AGENTCARD_API_TOKEN");
  let apiToken = envToken;
  let tokenSource: AgentCardConfig["tokenSource"] = envToken ? "env" : null;

  if (!apiToken) {
    const cliToken = readAgentCardTokenFromCliConfig();
    if (cliToken) {
      apiToken = cliToken;
      tokenSource = "cli-config";
    }
  }

  const apiBaseUrl =
    readOptional("AGENTCARD_API_URL") ?? "https://agentcard.ai";
  const maxCardAmountDollars = parsePositiveNumber(
    readOptional("AGENTCARD_MAX_CARD_AMOUNT_DOLLARS"),
    150,
  );
  const arDailyRaw = readOptional("AGENTCARD_AR_DAILY_CAP_USD");
  const arDailyCapUsd = arDailyRaw ? parsePositiveNumber(arDailyRaw, 0) : null;
  const enabledFlag = readOptional("AGENTCARD_ENABLED");
  const enabled =
    enabledFlag === "true" ||
    enabledFlag === "1" ||
    (enabledFlag !== "false" && Boolean(apiToken));

  return {
    apiToken,
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ""),
    maxCardAmountDollars: Math.min(maxCardAmountDollars, 150),
    arDailyCapUsd: arDailyCapUsd && arDailyCapUsd > 0 ? arDailyCapUsd : null,
    enabled: enabled && Boolean(apiToken),
    tokenSource,
  };
}

export function isAgentCardConfigured(): boolean {
  return getAgentCardConfig().enabled;
}
