/**
 * Provider ids are intentionally open-ended so credential-backed providers can be
 * added through the provider registry without widening a central string enum first.
 * The literals preserve autocomplete for the platform providers shipped today.
 */
export type AgentChatModelProvider =
  | "openrouter"
  | "opencode"
  | "google"
  | (string & {});

export type AgentChatModelAdapter =
  | "openrouter"
  | "opencode-openai-responses"
  | "opencode-anthropic-messages"
  | "opencode-google"
  | "opencode-openai-compatible"
  | "google-generative-ai"
  | "openai-responses"
  | "anthropic-messages"
  | "deepseek-anthropic-messages";

export type ModelCatalogFreshness = "fresh" | "stale";

export type ProviderToolProfile =
  | "none"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export type AgentChatModelDefinition = {
  modelKey: string;
  provider: AgentChatModelProvider;
  providerModelId: string;
  /** Concrete AI SDK transport used for this catalog model. */
  adapter: AgentChatModelAdapter;
  label: string;
  description: string;
  enabled: boolean;
  availability?: ModelAvailability;
  isDefault: boolean;
  /** Where the model's provider credential comes from. Platform is the default for legacy catalog rows. */
  credentialSource?: "platform" | "byok";
  /** Provider-neutral credential registry id used only when credentialSource is BYOK. */
  credentialProvider?: string;
  /** Who owns provider-side inference billing/quota. Platform is the default. */
  billingOwner?: "platform" | "user";
  /** Routing lane. User-owned BYOK models are normalized to byok:user by routing policy. */
  routingLane?: string;
  /** Provider-defined tools constrain physical failover to the same wire/tool profile. */
  providerToolProfile: ProviderToolProfile;
  /** Management-plane model catalog freshness; inference remains authoritative for runtime availability. */
  catalogFreshness?: ModelCatalogFreshness;
  catalogFetchedAt?: string;
  capabilities: {
    tools: boolean;
    reasoning: boolean;
    images: boolean;
    attachments: boolean;
    webSearch: boolean;
    /** Provider-published structured-output support when catalog metadata exposes it. */
    structuredOutputs?: boolean;
  };
  /** Total model context limit when known. */
  contextWindowTokens: number;
  /** Explicit provider input limit when separately published. */
  maxInputTokens?: number;
  /** Provider-enforced maximum output size. */
  providerMaxOutputTokens: number;
  /** AgentRanking's default requested output budget. */
  maxOutputTokens: number;
  pricing: {
    inputUsdMicrosPerMillion: number;
    outputUsdMicrosPerMillion: number;
    cachedInputUsdMicrosPerMillion?: number;
    cacheWriteUsdMicrosPerMillion?: number;
    reasoningUsdMicrosPerMillion?: number;
    pricingRevision: string;
  };
};

export type ModelAvailability =
  | "available"
  | "misconfigured"
  | "temporarily_unavailable";

export function modelInputLimitForOutput(
  model: AgentChatModelDefinition,
  requestedOutputTokens: number,
): number {
  const output = Math.max(
    0,
    Math.min(requestedOutputTokens, model.providerMaxOutputTokens),
  );
  const totalContextBound = Math.max(1, model.contextWindowTokens - output);
  return model.maxInputTokens === undefined
    ? totalContextBound
    : Math.min(model.maxInputTokens, totalContextBound);
}
