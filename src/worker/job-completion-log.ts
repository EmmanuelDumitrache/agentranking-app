export type CompletionLogSummary = {
  readonly completedSinceLastLog: number;
  readonly windowMs: number;
};

export function createCompletionLogLimiter(
  intervalMs = 60_000,
  maxCompletions = 1_000,
): (key: string, now?: number) => CompletionLogSummary | null {
  const state = new Map<string, { pending: number; lastLoggedAt: number }>();
  return (key, now = Date.now()) => {
    const current = state.get(key);
    if (!current) {
      state.set(key, { pending: 0, lastLoggedAt: now });
      return { completedSinceLastLog: 1, windowMs: 0 };
    }
    current.pending += 1;
    const windowMs = now - current.lastLoggedAt;
    if (current.pending < maxCompletions && windowMs < intervalMs) return null;
    const completedSinceLastLog = current.pending;
    current.pending = 0;
    current.lastLoggedAt = now;
    return { completedSinceLastLog, windowMs };
  };
}
