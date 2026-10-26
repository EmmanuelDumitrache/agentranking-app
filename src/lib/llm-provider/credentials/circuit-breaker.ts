import "server-only";

const states = new Map<string, {
  failures: number;
  windowStartedAt: number;
  openedUntil: number;
}>();

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function failureThreshold(): number {
  return envInt("LLM_PROVIDER_CIRCUIT_FAILURE_THRESHOLD", 3, 2, 20);
}

function failureWindowMs(): number {
  return envInt("LLM_PROVIDER_CIRCUIT_WINDOW_MS", 60_000, 5_000, 10 * 60_000);
}

function cooldownMs(): number {
  return envInt("LLM_PROVIDER_CIRCUIT_COOLDOWN_MS", 30_000, 5_000, 10 * 60_000);
}

export class ProviderCredentialCircuitOpenError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("Provider credential circuit is temporarily open");
    this.name = "ProviderCredentialCircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

export function assertProviderCredentialCircuitAvailable(key: string): void {
  const state = states.get(key);
  if (!state) return;
  const now = Date.now();
  if (state.openedUntil > now) {
    throw new ProviderCredentialCircuitOpenError(state.openedUntil - now);
  }
  if (state.openedUntil > 0) {
    // Cooldown elapsed. Allow a probe and start a fresh failure window.
    states.set(key, { failures: 0, windowStartedAt: now, openedUntil: 0 });
  }
}

export function recordProviderCredentialSuccess(key: string): void {
  states.delete(key);
}

export function recordProviderCredentialTransientFailure(key: string): void {
  const now = Date.now();
  const windowMs = failureWindowMs();
  const current = states.get(key);
  const state = !current || now - current.windowStartedAt > windowMs
    ? { failures: 0, windowStartedAt: now, openedUntil: 0 }
    : current;
  state.failures += 1;
  if (state.failures >= failureThreshold()) {
    state.openedUntil = now + cooldownMs();
  }
  states.set(key, state);

  // This is a bounded process-local cache, not durable state. Drop old entries
  // opportunistically so a high-cardinality multi-tenant deployment cannot grow
  // the map without bound.
  if (states.size > 2_000) {
    for (const [candidateKey, candidate] of states) {
      if (candidate.openedUntil <= now && now - candidate.windowStartedAt > windowMs) {
        states.delete(candidateKey);
      }
      if (states.size <= 1_500) break;
    }
  }
}

export async function withProviderCredentialCircuit<T>(input: {
  key: string;
  operation: () => Promise<T>;
  isTransientFailure: (error: unknown) => boolean;
}): Promise<T> {
  assertProviderCredentialCircuitAvailable(input.key);
  try {
    const result = await input.operation();
    recordProviderCredentialSuccess(input.key);
    return result;
  } catch (error) {
    if (input.isTransientFailure(error)) {
      recordProviderCredentialTransientFailure(input.key);
    }
    throw error;
  }
}
