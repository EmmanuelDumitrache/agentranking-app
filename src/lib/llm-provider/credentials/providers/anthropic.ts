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

export const ANTHROPIC_PROVIDER_ID = "anthropic";
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_MAX_MODEL_PAGES = 5;
const ANTHROPIC_MODEL_PAGE_SIZE = 1_000;
const ANTHROPIC_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const CapabilitySupportSchema = z.object({ supported: z.boolean().optional() });
const AnthropicModelSchema = z.object({
  id: z.string().optional(),
  display_name: z.string().optional(),
  created_at: z.string().optional(),
  max_input_tokens: z.number().optional(),
  max_tokens: z.number().optional(),
  capabilities: z.object({
    image_input: CapabilitySupportSchema.optional(),
    pdf_input: CapabilitySupportSchema.optional(),
    thinking: CapabilitySupportSchema.optional(),
    structured_outputs: CapabilitySupportSchema.optional(),
  }).optional(),
});

type AnthropicModel = z.infer<typeof AnthropicModelSchema>;

const AnthropicModelListSchema = z.object({
  data: z.array(AnthropicModelSchema).optional(),
  has_more: z.boolean().optional(),
  last_id: z.string().nullable().optional(),
});

export type AnthropicModelList = z.infer<typeof AnthropicModelListSchema>;

function fallbackAnthropicLimits(modelId: string): {
  maxInputTokens: number;
  providerMaxOutputTokens: number;
} {
  if (/claude-(?:opus|sonnet|haiku)-4(?:[.-]|$)/i.test(modelId)) {
    return { maxInputTokens: 200_000, providerMaxOutputTokens: 64_000 };
  }
  return { maxInputTokens: 200_000, providerMaxOutputTokens: 16_384 };
}

async function classifyAnthropicStatus(response: Response) {
  const body = await response.text().catch(() => "");
  return classifyProviderFailure({
    provider: ANTHROPIC_PROVIDER_ID,
    source: "catalog",
    error: {
      statusCode: response.status,
      responseBody: body,
      responseHeaders: Object.fromEntries(response.headers.entries()),
    },
  });
}

function mapAnthropicModel(model: AnthropicModel): AgentChatModelDefinition | null {
  const providerModelId = model.id?.trim();
  if (!providerModelId) return null;
  const fallback = fallbackAnthropicLimits(providerModelId);
  const maxInputTokens = Number.isSafeInteger(model.max_input_tokens) && (model.max_input_tokens ?? 0) > 0
    ? model.max_input_tokens as number
    : fallback.maxInputTokens;
  const providerMaxOutputTokens = Number.isSafeInteger(model.max_tokens) && (model.max_tokens ?? 0) > 0
    ? model.max_tokens as number
    : fallback.providerMaxOutputTokens;
  const contextWindowTokens = maxInputTokens + providerMaxOutputTokens;
  const supportsImages = model.capabilities?.image_input?.supported === true;
  const supportsPdf = model.capabilities?.pdf_input?.supported === true;
  return {
    modelKey: `byok:${ANTHROPIC_PROVIDER_ID}:${encodeURIComponent(providerModelId)}`,
    provider: ANTHROPIC_PROVIDER_ID,
    providerModelId,
    adapter: "anthropic-messages",
    label: model.display_name?.trim() || providerModelId,
    description: `Claude model · ${Math.round(maxInputTokens / 1_000)}K input · account-billed`,
    enabled: true,
    availability: "available",
    isDefault: false,
    credentialSource: "byok",
    credentialProvider: ANTHROPIC_PROVIDER_ID,
    billingOwner: "user",
    routingLane: "byok:user",
    providerToolProfile: "anthropic-messages",
    capabilities: {
      tools: true,
      reasoning: model.capabilities?.thinking?.supported === true,
      images: supportsImages,
      attachments: supportsImages || supportsPdf,
      webSearch: true,
      structuredOutputs: model.capabilities?.structured_outputs?.supported === true,
    },
    contextWindowTokens,
    maxInputTokens,
    providerMaxOutputTokens,
    maxOutputTokens: Math.min(APPLICATION_BYOK_MAX_OUTPUT_TOKENS, providerMaxOutputTokens),
    pricing: userBilledPricing(ANTHROPIC_PROVIDER_ID),
  };
}

async function fetchAnthropicModels(apiKey: string, signal?: AbortSignal): Promise<AgentChatModelDefinition[]> {
  const models: AgentChatModelDefinition[] = [];
  let afterId: string | undefined;
  for (let page = 0; page < ANTHROPIC_MAX_MODEL_PAGES; page += 1) {
    const url = new URL(ANTHROPIC_MODELS_URL);
    url.searchParams.set("limit", String(ANTHROPIC_MODEL_PAGE_SIZE));
    if (afterId) url.searchParams.set("after_id", afterId);
    const response = await fetchProviderCredentialEndpoint({
      provider: ANTHROPIC_PROVIDER_ID,
      providerLabel: "Anthropic",
      url,
      signal,
      init: {
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
        },
      },
      classify: classifyAnthropicStatus,
    });
    const payload = await parseBoundedJsonBody(response, AnthropicModelListSchema, ANTHROPIC_MAX_RESPONSE_BYTES);
    for (const item of payload.data ?? []) {
      const mapped = mapAnthropicModel(item);
      if (mapped) models.push(mapped);
    }
    const next = payload.last_id?.trim() || undefined;
    if (!payload.has_more || !next || next === afterId) break;
    afterId = next;
  }
  if (models.length === 0) {
    throw createProviderRuntimeFailure({
      provider: ANTHROPIC_PROVIDER_ID,
      source: "catalog",
      kind: "model_not_found",
      providerMessage: "The Anthropic key is valid, but no Claude models are available to this account",
    });
  }
  return models.sort((a, b) => {
    if (a.capabilities.reasoning !== b.capabilities.reasoning) return a.capabilities.reasoning ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export const anthropicAdapter: ProviderCredentialAdapter = {
  descriptor: {
    id: ANTHROPIC_PROVIDER_ID,
    label: "Anthropic",
    credentialLabel: "Anthropic API key",
    description: "Use your own Anthropic quota for Claude models through the Messages API.",
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  listModels: fetchAnthropicModels,
  createRuntime(modelId, secret, context) {
    const provider = createAnthropic({
      apiKey: secret,
      fetch: createCircuitAwareProviderFetch({
        circuitKey: context.inferenceCircuitKey,
        provider: ANTHROPIC_PROVIDER_ID,
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
