import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
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

export const GOOGLE_PROVIDER_ID = "google-ai-studio";
const GOOGLE_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GOOGLE_MAX_MODEL_PAGES = 5;
const GOOGLE_MODEL_PAGE_SIZE = 100;
const GOOGLE_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const GoogleModelSchema = z.object({
  name: z.string().optional(),
  baseModelId: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  inputTokenLimit: z.number().optional(),
  outputTokenLimit: z.number().optional(),
  supportedGenerationMethods: z.array(z.string()).optional(),
  thinking: z.boolean().optional(),
});

type GoogleModel = z.infer<typeof GoogleModelSchema>;

const GoogleModelListSchema = z.object({
  models: z.array(GoogleModelSchema).optional(),
  nextPageToken: z.string().optional(),
});

export type GoogleModelList = z.infer<typeof GoogleModelListSchema>;

async function classifyGoogleStatus(response: Response) {
  const body = await response.text().catch(() => "");
  return classifyProviderFailure({
    provider: GOOGLE_PROVIDER_ID,
    source: "catalog",
    error: {
      statusCode: response.status,
      responseBody: body,
      responseHeaders: Object.fromEntries(response.headers.entries()),
    },
  });
}

function isChatModel(model: GoogleModel): boolean {
  const methods = model.supportedGenerationMethods ?? [];
  if (!methods.includes("generateContent")) return false;
  const id = (model.baseModelId || model.name?.replace(/^models\//, "") || "").toLowerCase();
  if (!id) return false;
  return !/(embedding|embed-|aqa|imagen|veo|tts|text-to-speech|native-audio|live$)/i.test(id);
}

function mapGoogleModel(model: GoogleModel): AgentChatModelDefinition | null {
  if (!isChatModel(model)) return null;
  const providerModelId = (model.baseModelId || model.name?.replace(/^models\//, "") || "").trim();
  if (!providerModelId) return null;
  const maxInputTokens = Number.isSafeInteger(model.inputTokenLimit) && (model.inputTokenLimit ?? 0) > 0
    ? model.inputTokenLimit as number
    : 32_768;
  const providerMaxOutputTokens = Number.isSafeInteger(model.outputTokenLimit) && (model.outputTokenLimit ?? 0) > 0
    ? model.outputTokenLimit as number
    : 8_192;
  const contextWindowTokens = maxInputTokens + providerMaxOutputTokens;
  const isGemma = /^gemma(?:-|$)/i.test(providerModelId);
  const isGemma4 = /^gemma-4(?:-|$)/i.test(providerModelId);
  const tools = !isGemma || isGemma4;
  return {
    modelKey: `byok:${GOOGLE_PROVIDER_ID}:${encodeURIComponent(providerModelId)}`,
    provider: "google",
    providerModelId,
    adapter: "google-generative-ai",
    label: model.displayName?.trim() || providerModelId,
    description: `${model.description?.trim() || "Google Generative AI model"} · ${Math.round(maxInputTokens / 1_000)}K input`,
    enabled: true,
    availability: "available",
    isDefault: false,
    credentialSource: "byok",
    credentialProvider: GOOGLE_PROVIDER_ID,
    billingOwner: "user",
    routingLane: "byok:user",
    providerToolProfile: "google-generative-ai",
    capabilities: {
      tools,
      reasoning: model.thinking === true || isGemma4,
      images: !isGemma || isGemma4,
      attachments: !isGemma || isGemma4,
      webSearch: tools && !isGemma,
    },
    contextWindowTokens,
    maxInputTokens,
    providerMaxOutputTokens,
    maxOutputTokens: Math.min(APPLICATION_BYOK_MAX_OUTPUT_TOKENS, providerMaxOutputTokens),
    pricing: userBilledPricing(GOOGLE_PROVIDER_ID),
  };
}

async function fetchGoogleModels(apiKey: string, signal?: AbortSignal): Promise<AgentChatModelDefinition[]> {
  const models: AgentChatModelDefinition[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < GOOGLE_MAX_MODEL_PAGES; page += 1) {
    const url = new URL(GOOGLE_MODELS_URL);
    url.searchParams.set("pageSize", String(GOOGLE_MODEL_PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetchProviderCredentialEndpoint({
      provider: GOOGLE_PROVIDER_ID,
      providerLabel: "Google Gemini",
      url,
      signal,
      init: { headers: { "x-goog-api-key": apiKey } },
      classify: classifyGoogleStatus,
    });
    const payload = await parseBoundedJsonBody(response, GoogleModelListSchema, GOOGLE_MAX_RESPONSE_BYTES);
    for (const item of payload.models ?? []) {
      const mapped = mapGoogleModel(item);
      if (mapped) models.push(mapped);
    }
    pageToken = payload.nextPageToken?.trim() || undefined;
    if (!pageToken) break;
  }
  if (models.length === 0) {
    throw createProviderRuntimeFailure({
      provider: GOOGLE_PROVIDER_ID,
      source: "catalog",
      kind: "model_not_found",
      providerMessage: "The key is valid, but no chat-compatible generateContent models are available",
    });
  }
  return models.sort((a, b) => {
    if (a.capabilities.tools !== b.capabilities.tools) return a.capabilities.tools ? -1 : 1;
    if (a.capabilities.reasoning !== b.capabilities.reasoning) return a.capabilities.reasoning ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export const googleAiStudioAdapter: ProviderCredentialAdapter = {
  descriptor: {
    id: GOOGLE_PROVIDER_ID,
    label: "Google AI Studio",
    credentialLabel: "Gemini API key",
    description: "Use your own Google AI Studio quota for Gemini and Gemma models.",
    helpUrl: "https://aistudio.google.com/app/apikey",
  },
  listModels: fetchGoogleModels,
  createRuntime(modelId, secret, context) {
    const provider = createGoogleGenerativeAI({
      apiKey: secret,
      fetch: createCircuitAwareProviderFetch({
        circuitKey: context.inferenceCircuitKey,
        provider: GOOGLE_PROVIDER_ID,
        providerModelId: modelId,
      }),
    });
    return {
      languageModel: provider(modelId),
      providerTools: {
        web_search: provider.tools.googleSearch({}) as unknown as ToolSet[string],
      },
    };
  },
};
