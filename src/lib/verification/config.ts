/**
 * Account verification product config — env-driven, no provider names in callers.
 */

function envFlag(name: string, defaultOn = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isVerificationEnabled(): boolean {
  return envFlag("VERIFICATION_ENABLED", true);
}

export function isAgentPaymentsEnabled(): boolean {
  return envFlag("AGENT_PAYMENTS_ENABLED", true);
}

export function isCardIssuanceEnabled(): boolean {
  return envFlag("CARD_ISSUANCE_ENABLED", true);
}

/** Non-production: allow dev bypass button + server-side skip of KYC gate. */
export function isKycDevBypassActive(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return envFlag("KYC_DEV_BYPASS", false);
}

/** Local skip / floating widget — any signed-in user, non-production only. */
export function isVerificationDevToolsActive(_accountEmail?: string | null): boolean {
  return process.env.NODE_ENV !== "production";
}

export function getPersonaApiKey(): string {
  return (process.env.PERSONA_API_KEY ?? "").trim();
}

export function getPersonaTemplateId(): string {
  return (process.env.PERSONA_TEMPLATE_ID ?? "").trim();
}

export function getPersonaWebhookSecret(): string {
  return (process.env.PERSONA_WEBHOOK_SECRET ?? "").trim();
}

export function getPersonaApiVersion(): string {
  return (process.env.PERSONA_API_VERSION ?? "2025-12-08").trim();
}

export function getPersonaEnvironmentId(): string {
  return (process.env.PERSONA_ENVIRONMENT_ID ?? "").trim();
}

export function isPersonaConfigured(): boolean {
  return Boolean(getPersonaApiKey() && getPersonaTemplateId());
}

export function getKycProviderId(): "mock" | "persona" | "civic" {
  const raw = process.env.KYC_PROVIDER?.trim().toLowerCase();
  if (raw === "persona") return "persona";
  if (raw === "civic") return "civic";
  if (raw === "mock") return "mock";
  // Production uses real KYC; local dev defaults to mock when unset.
  if (process.env.NODE_ENV === "production") return "persona";
  return "mock";
}

export function isPersonaEmbeddedAvailable(): boolean {
  return isPersonaConfigured() && Boolean(getPersonaEnvironmentId());
}
