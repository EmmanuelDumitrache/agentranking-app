import type { AgentChatModelDefinition } from "@/features/agent-chat/shared/model-registry-types";

export type OpenAiModelFamilyMetadata = {
  match: (modelId: string) => boolean;
  contextWindowTokens: number;
  providerMaxOutputTokens: number;
  maxInputTokens?: number;
  capabilities: AgentChatModelDefinition["capabilities"];
};

const FAMILY_REGISTRY: readonly OpenAiModelFamilyMetadata[] = [
  // Keep narrower derivative families before their broader parent family.
  {
    match: (id) => /^(?:codex|gpt-5-codex)(?:[.-]|$)/i.test(id),
    contextWindowTokens: 200_000,
    providerMaxOutputTokens: 100_000,
    capabilities: { tools: true, reasoning: true, images: false, attachments: true, webSearch: true },
  },
  {
    match: (id) => /^gpt-5(?:[.-]|$)/i.test(id),
    contextWindowTokens: 400_000,
    providerMaxOutputTokens: 128_000,
    capabilities: { tools: true, reasoning: true, images: true, attachments: true, webSearch: true },
  },
  {
    match: (id) => /^gpt-4\.1(?:[.-]|$)/i.test(id),
    contextWindowTokens: 1_000_000,
    providerMaxOutputTokens: 32_768,
    capabilities: { tools: true, reasoning: false, images: true, attachments: true, webSearch: true },
  },
  {
    match: (id) => /^gpt-4o(?:[.-]|$)/i.test(id),
    contextWindowTokens: 128_000,
    providerMaxOutputTokens: 16_384,
    capabilities: { tools: true, reasoning: false, images: true, attachments: true, webSearch: true },
  },
  {
    match: (id) => /^(?:o1|o3|o4)(?:[.-]|$)/i.test(id),
    contextWindowTokens: 200_000,
    providerMaxOutputTokens: 100_000,
    capabilities: { tools: true, reasoning: true, images: true, attachments: true, webSearch: true },
  },
];

const CONSERVATIVE_UNKNOWN: OpenAiModelFamilyMetadata = {
  match: () => true,
  contextWindowTokens: 32_768,
  providerMaxOutputTokens: 8_192,
  maxInputTokens: 24_576,
  capabilities: {
    tools: false,
    reasoning: false,
    images: false,
    attachments: false,
    webSearch: false,
  },
};

export function openAiModelMetadata(modelId: string): OpenAiModelFamilyMetadata {
  const base = modelId.startsWith("ft:")
    ? modelId.slice(3).split(":", 1)[0] || modelId
    : modelId;
  return FAMILY_REGISTRY.find((entry) => entry.match(base)) ?? CONSERVATIVE_UNKNOWN;
}
