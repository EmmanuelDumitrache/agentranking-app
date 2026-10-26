

export function normalizeXHandle(input: string): string {
  const raw = input.trim().replace(/^@+/, "");
  if (!raw) return "";
  if (!/^[A-Za-z0-9_]{1,15}$/.test(raw)) return "";
  return `@${raw}`;
}
/** TODO: Helio webhook — set paymentStatus=paid on linked AgentVerificationRequest when Order completes. */