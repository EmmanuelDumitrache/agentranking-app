const SENSITIVE_KEYS = new Set([
  "pan",
  "cvv",
  "cvc",
  "cardNumber",
  "card_number",
  "number",
  "expiryMonth",
  "expiryYear",
  "zip",
  "billingAddress",
  "billing_address",
  "cardholderName",
  "cardholder_name",
  "otp",
  "verificationCode",
  "verification_code",
  "threeDsCode",
  "three_ds_code",
]);

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    if (key === "card" && child && typeof child === "object") {
      out[key] = redactCardObject(child as Record<string, unknown>);
      continue;
    }
    out[key] = redactValue(child);
  }
  return out;
}

function redactCardObject(card: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactValue(card) as Record<string, unknown>;
  if (typeof card.last4 === "string" || typeof card.lastFour === "string") {
    redacted.last4 = card.last4 ?? card.lastFour;
    redacted.lastFour = card.lastFour ?? card.last4;
  }
  redacted.sensitive = true;
  return redacted;
}

export function redactAgentCardPayload<T>(value: T): T {
  return redactValue(value) as T;
}

export function isAgentCardToolName(toolName: string): boolean {
  return toolName.startsWith("agentcard_");
}
