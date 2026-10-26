function envFlag(name: string, defaultOn = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return defaultOn;
}

function envInt(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(maximum, value) : fallback;
}

export const FAIRSCALE_METHODOLOGY_URL = "https://docs.fairscale.xyz/docs/agent-score";
/** Agent Trust product — five-pillar agent reputation on agent-api. */
export const FAIRSCALE_AGENT_SCORE_PATH = "/v1/score";
export const FAIRSCALE_AGENT_SCORE_BATCH_PATH = "/v1/score/batch";
/** Human Reputation API on `api.fairscale.xyz`; retained only as an explicit compatibility mode. */
export const FAIRSCALE_HUMAN_SCORE_PATH = "/score";
export const FAIRSCALE_HUMAN_FAIR_SCORE_PATH = "/fairScore";
export const FAIRSCALE_HUMAN_WALLET_SCORE_PATH = "/walletScore";
export const FAIRSCALE_HUMAN_SOCIAL_SCORE_PATH = "/socialScore";

export type FairscaleScoreSource = "agent" | "human";

export function fairscaleEnabled(): boolean {
  return envFlag("FAIRSCALE_ENABLED", false);
}

/** Public nav / docs partner visibility — off unless explicitly enabled. */
export function fairscaleClientUiEnabled(): boolean {
  return envFlag("NEXT_PUBLIC_FAIRSCALE_ENABLED", false);
}

/**
 * When true, page loads may queue background FairScale API calls.
 * Default off — use the manual request action to avoid consuming provider quota unexpectedly.
 */
export function fairscaleAutoRefreshEnabled(): boolean {
  return envFlag("FAIRSCALE_AUTO_REFRESH", false);
}

/** Agent wallets use FairScale Agent Trust by default. Human reputation requires an explicit override. */
export function resolveFairscaleScoreSource(): FairscaleScoreSource {
  return process.env.FAIRSCALE_SCORE_SOURCE?.trim().toLowerCase() === "human"
    ? "human"
    : "agent";
}

/** Agent Trust API host (`/v1/score`, batch). */
export function resolveFairscaleApiBaseUrl(): string {
  const raw = process.env.FAIRSCALE_API_BASE_URL?.trim();
  return (raw || "https://agent-api.fairscale.xyz").replace(/\/$/, "");
}

/** Human Reputation API host (`/score`, `/fairScore`, `/walletScore`, `/socialScore`). */
export function resolveFairscaleHumanApiBaseUrl(): string {
  const raw = process.env.FAIRSCALE_HUMAN_API_BASE_URL?.trim();
  return (raw || "https://api.fairscale.xyz").replace(/\/$/, "");
}

export function resolveFairscaleApiKey(): string | null {
  const raw = process.env.FAIRSCALE_API_KEY?.trim();
  return raw || null;
}

/**
 * FairScale documents Agent Trust scores as short-lived. Minutes are canonical; the former hours
 * variable remains a higher-priority compatibility override so existing deployments do not change
 * silently until their environment is migrated.
 */
export function resolveFairscaleCacheMinutes(): number {
  const hours = process.env.FAIRSCALE_CACHE_HOURS?.trim();
  if (hours && /^\d+$/.test(hours)) {
    const value = Number(hours);
    if (Number.isSafeInteger(value) && value > 0) return Math.min(24 * 30, value) * 60;
  }
  return envInt("FAIRSCALE_CACHE_MINUTES", 15, 24 * 60);
}

export function resolveFairscaleCacheTtlMs(): number {
  return resolveFairscaleCacheMinutes() * 60 * 1_000;
}

export function resolveFairscaleSyncLimit(): number {
  return envInt("FAIRSCALE_SYNC_LIMIT", 100, 10_000);
}

export function resolveFairscaleSyncConcurrency(): number {
  return envInt("FAIRSCALE_SYNC_CONCURRENCY", 3, 16);
}

export function resolveFairscaleFailureRetryMs(): number {
  return envInt("FAIRSCALE_FAILURE_RETRY_MINUTES", 60, 24 * 60) * 60 * 1_000;
}

export const FAIRSCALE_BATCH_MAX = 25;
export const FAIRSCALE_REQUEST_TIMEOUT_MS = 12_000;
export const FAIRSCALE_USER_AGENT =
  "AgentRanking-FairScale/1.0 (+https://agentranking.io)";
