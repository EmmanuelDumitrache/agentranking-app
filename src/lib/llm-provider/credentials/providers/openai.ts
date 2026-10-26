import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import type { AgentChatModelDefinition } from "@/features/agent-chat/shared/model-registry-types";
import {
  APPLICATION_BYOK_MAX_OUTPUT_TOKENS,
  type ProviderCredentialAdapter,
  userBilledPricing,
} from "../provider-adapter";
import {
  createCircuitAwareProviderFetch,
  fetchProviderCredentialEndpoint,
} from "../provider-http";
import {
  classifyProviderFailure,
  createProviderRuntimeFailure,
} from "@/lib/llm-provider/provider-failure";
import { openAiModelMetadata } from "./openai-model-metadata";

export const OPENAI_PROVIDER_ID = "openai";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const OPENAI_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const OpenAiModelSchema = z.object({
  id: z.string().optional(),
  object: z.string().optional(),
  created: z.number().optional(),
  owned_by: z.string().optional(),
});

type OpenAiModel = z.infer<typeof OpenAiModelSchema>;

const OpenAiModelListSchema = z.object({
  object: z.string().optional(),
  data: z.array(OpenAiModelSchema).optional(),
});

export type OpenAiModelList = z.infer<typeof OpenAiModelListSchema>;

async function classifyOpenAiStatus(response: Response) {
  const responseBody = await response.text().catch(() => "");
  return classifyProviderFailure({
    provider: OPENAI_PROVIDER_ID,
    source: "catalog",
    error: {
      statusCode: response.status,
      responseBody,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      message: responseBody || `OpenAI catalog request failed`,
    },
  });
}

function underlyingOpenAiModelId(id: string): string {
  if (!id.startsWith("ft:")) return id;
  return id.slice(3).split(":", 1)[0] || id;
}

function isOpenAiAgentModel(id: string): boolean {
  const base = underlyingOpenAiModelId(id).toLowerCase();
  // /v1/models is the authority for credential-visible model IDs. Keep only
  // deterministic exclusions for model classes that are not text-generation
  // candidates; unknown generation IDs are retained and enriched with the
  // conservative metadata fallback rather than being hidden by a family list.
  return !/(realtime|audio|transcribe|tts|text-to-speech|embedding|moderation|whisper|dall-e|image|sora|search-preview|deep-research|computer-use)/i.test(base);
}

function mapOpenAiModel(model: OpenAiModel): AgentChatModelDefinition | null {
  const providerModelId = model.id?.trim();
  if (!providerModelId || !isOpenAiAgentModel(providerModelId)) return null;
  const metadata = openAiModelMetadata(providerModelId);
  return {
    modelKey: `byok:${OPENAI_PROVIDER_ID}:${encodeURIComponent(providerModelId)}`,
    provider: OPENAI_PROVIDER_ID,
    providerModelId,
    adapter: "openai-responses",
    label: providerModelId,
    description: `OpenAI model · ${Math.round(metadata.contextWindowTokens / 1_000)}K ctx · account-billed`,
    enabled: true,
    availability: "available",
    isDefault: false,
    credentialSource: "byok",
    credentialProvider: OPENAI_PROVIDER_ID,
    billingOwner: "user",
    routingLane: "byok:user",
    providerToolProfile: "openai-responses",
    capabilities: metadata.capabilities,
    contextWindowTokens: metadata.contextWindowTokens,
    ...(metadata.maxInputTokens ? { maxInputTokens: metadata.maxInputTokens } : {}),
    providerMaxOutputTokens: metadata.providerMaxOutputTokens,
    maxOutputTokens: Math.min(
      APPLICATION_BYOK_MAX_OUTPUT_TOKENS,
      metadata.providerMaxOutputTokens,
    ),
    pricing: userBilledPricing(OPENAI_PROVIDER_ID),
  };
}

async function fetchOpenAiModels(apiKey: string, signal?: AbortSignal): Promise<AgentChatModelDefinition[]> {
  const response = await fetchProviderCredentialEndpoint({
    provider: OPENAI_PROVIDER_ID,
    providerLabel: "OpenAI",
    url: new URL(OPENAI_MODELS_URL),
    signal,
    init: { headers: { Authorization: `Bearer ${apiKey}` } },
    classify: classifyOpenAiStatus,
  });
  const payload = await parseBoundedJsonBody(response, OpenAiModelListSchema, OPENAI_MAX_RESPONSE_BYTES);
  const models = (payload.data ?? [])
    .map(mapOpenAiModel)
    .filter((model): model is AgentChatModelDefinition => model !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
  if (models.length === 0) {
    throw createProviderRuntimeFailure({
      provider: OPENAI_PROVIDER_ID,
      source: "catalog",
      kind: "model_not_found",
      providerMessage: "The OpenAI key is valid, but no Responses-compatible agent models are available to this project",
    });
  }
  return models;
}

export const openAiAdapter: ProviderCredentialAdapter = {
  descriptor: {
    id: OPENAI_PROVIDER_ID,
    label: "OpenAI",
    credentialLabel: "OpenAI API key",
    description: "Use your own OpenAI project quota for GPT and reasoning models through the Responses API.",
    helpUrl: "https://platform.openai.com/api-keys",
  },
  listModels: fetchOpenAiModels,
  createRuntime(modelId, secret, context) {
    const provider = createOpenAI({
      apiKey: secret,
      fetch: createCircuitAwareProviderFetch({
        circuitKey: context.inferenceCircuitKey,
        provider: OPENAI_PROVIDER_ID,
        providerModelId: modelId,
      }),
    });
    const providerTools: ToolSet = {
      web_search: provider.tools.webSearch({}) as unknown as ToolSet[string],
    };
    return {
      languageModel: provider.responses(modelId),
      providerTools,
    };
  },
};
