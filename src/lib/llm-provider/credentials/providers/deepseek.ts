import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
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

export const DEEPSEEK_PROVIDER_ID = "deepseek";
const DEEPSEEK_MODELS_URL = "https://api.deepseek.com/models";
const DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";
const DEEPSEEK_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const DeepSeekModelSchema = z.object({
  id: z.string().optional(),
  object: z.string().optional(),
  owned_by: z.string().optional(),
});

type DeepSeekModel = z.infer<typeof DeepSeekModelSchema>;

const DeepSeekModelListSchema = z.object({
  object: z.string().optional(),
  data: z.array(DeepSeekModelSchema).optional(),
});

async function classifyDeepSeekStatus(response: Response) {
  const responseBody = await response.text().catch(() => "");
  return classifyProviderFailure({
    provider: DEEPSEEK_PROVIDER_ID,
    source: "catalog",
    error: {
      statusCode: response.status,
      responseBody,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      message: responseBody || `DeepSeek catalog request failed`,
    },
  });
}

function mapDeepSeekModel(model: DeepSeekModel): AgentChatModelDefinition | null {
  const providerModelId = model.id?.trim();
  if (!providerModelId || !/^deepseek-v4-(?:pro|flash)$/i.test(providerModelId)) return null;
  return {
    modelKey: `byok:${DEEPSEEK_PROVIDER_ID}:${encodeURIComponent(providerModelId)}`,
    provider: DEEPSEEK_PROVIDER_ID,
    providerModelId,
    adapter: "deepseek-anthropic-messages",
    label: providerModelId === "deepseek-v4-pro" ? "DeepSeek V4 Pro" : "DeepSeek V4 Flash",
    description: "DeepSeek V4 · 1M context · tool calling · thinking/non-thinking · account-billed",
    enabled: true,
    availability: "available",
    isDefault: false,
    credentialSource: "byok",
    credentialProvider: DEEPSEEK_PROVIDER_ID,
    billingOwner: "user",
    routingLane: "byok:user",
    providerToolProfile: "anthropic-messages",
    capabilities: {
      tools: true,
      reasoning: true,
      images: false,
      attachments: false,
      webSearch: true,
    },
    contextWindowTokens: 1_000_000,
    providerMaxOutputTokens: 384_000,
    maxOutputTokens: Math.min(APPLICATION_BYOK_MAX_OUTPUT_TOKENS, 384_000),
    pricing: userBilledPricing(DEEPSEEK_PROVIDER_ID),
  };
}

async function fetchDeepSeekModels(apiKey: string, signal?: AbortSignal): Promise<AgentChatModelDefinition[]> {
  const response = await fetchProviderCredentialEndpoint({
    provider: DEEPSEEK_PROVIDER_ID,
    providerLabel: "DeepSeek",
    url: new URL(DEEPSEEK_MODELS_URL),
    signal,
    init: { headers: { Authorization: `Bearer ${apiKey}` } },
    classify: classifyDeepSeekStatus,
  });
  const payload = await parseBoundedJsonBody(response, DeepSeekModelListSchema, DEEPSEEK_MAX_RESPONSE_BYTES);
  const models = (payload.data ?? [])
    .map(mapDeepSeekModel)
    .filter((model): model is AgentChatModelDefinition => model !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
  if (models.length === 0) {
    throw createProviderRuntimeFailure({
      provider: DEEPSEEK_PROVIDER_ID,
      source: "catalog",
      kind: "model_not_found",
      providerMessage: "The DeepSeek key is valid, but no supported DeepSeek V4 models are available",
    });
  }
  return models;
}

export const deepSeekAdapter: ProviderCredentialAdapter = {
  descriptor: {
    id: DEEPSEEK_PROVIDER_ID,
    label: "DeepSeek",
    credentialLabel: "DeepSeek API key",
    description: "Use DeepSeek V4 with your own quota through DeepSeek's Anthropic-compatible agent endpoint.",
    helpUrl: "https://platform.deepseek.com/api_keys",
  },
  listModels: fetchDeepSeekModels,
  createRuntime(modelId, secret, context) {
    const provider = createAnthropic({
      apiKey: secret,
      baseURL: DEEPSEEK_ANTHROPIC_BASE_URL,
      name: "deepseek",
      fetch: createCircuitAwareProviderFetch({
        circuitKey: context.inferenceCircuitKey,
        provider: DEEPSEEK_PROVIDER_ID,
        providerModelId: modelId,
      }),
    });
    return {
      languageModel: provider.messages(modelId),
      providerTools: {
        web_search: provider.tools.webSearch_20250305({ maxUses: 5 }) as unknown as ToolSet[string],
      },
    };
  },
};
