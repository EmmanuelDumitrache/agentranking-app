export function readMaxAgentsForAccount(): number {
  const raw = process.env.AGENT_ACCOUNT_MAX_FREE_AGENTS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 3;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}
export function readDefaultAccountCredits(envKey: "PLATFORM_CREDITS_DEFAULT_BALANCE" | "LLM_CREDITS_DEFAULT_BALANCE"): number {
  const raw = process.env[envKey]?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}