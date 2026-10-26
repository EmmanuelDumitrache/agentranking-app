import { safeErrorDetails } from "@/lib/security/sensitive-data-redaction";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  AgentChatModelAdapter,
  AgentChatModelDefinition,
  ModelAvailability,
} from "../shared/model-registry-types";
import { HttpError } from "./http-error";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import {
  decimalAmountToScaledInteger,
  usdAmountToMicros,
} from "@/lib/llm-provider/costing";
import {
  readExternalProviderCache,
  writeExternalProviderCache,
} from "@/lib/external-provider-cache";
import { getAccountByokModels, resolveByokModel } from "@/lib/llm-provider/credentials/service";
const CACHE_FRESH_TTL_SECONDS = 5 * 60;
const CACHE_STALE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
const APPLICATION_MAX_OUTPUT_TOKENS = 8_192;
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const MODELS_DEV_API_URL = "https://models.dev/api.json";
const DEFAULT_OPENCODE_BASE_URL = "https://opencode.ai/zen/v1";
let inflight: Promise<AgentChatModelDefinition[]> | null = null;

const OpenRouterModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  context_length: z.number(),
  pricing: z.object({ prompt: z.string(), completion: z.string() }),
  top_provider: z.object({ max_completion_tokens: z.number().nullish(), is_moderated: z.boolean().optional() }).optional(),
  architecture: z.object({ input_modalities: z.array(z.string()).optional(), output_modalities: z.array(z.string()).optional() }).optional(),
  supported_parameters: z.array(z.string()).optional(),
});

type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>;

const OpenRouterModelListSchema = z.object({
  data: z.array(OpenRouterModelSchema).optional(),
});

const OpenCodeCatalogModelSchema = z.object({
  id: z.string(),
  object: z.string().optional(),
  created: z.number().optional(),
  owned_by: z.string().optional(),
});

export type OpenCodeCatalogModel = z.infer<typeof OpenCodeCatalogModelSchema>;

const OpenCodeCatalogResponseSchema = z.object({
  data: z.array(OpenCodeCatalogModelSchema).optional(),
});

const ModelsDevModelSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  attachment: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  status: z.string().optional(),
  cost: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
    reasoning: z.number().optional(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
  }).optional(),
  limit: z.object({
    context: z.number().optional(),
    input: z.number().optional(),
    output: z.number().optional(),
  }).optional(),
  modalities: z.object({
    input: z.array(z.string()).optional(),
    output: z.array(z.string()).optional(),
  }).optional(),
  provider: z.object({
    npm: z.string().optional(),
  }).optional(),
});

export type ModelsDevModel = z.infer<typeof ModelsDevModelSchema>;

const ModelsDevProviderSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  npm: z.string().optional(),
  api: z.string().optional(),
  env: z.array(z.string()).optional(),
  models: z.record(z.string(), ModelsDevModelSchema).optional(),
});

export type ModelsDevProvider = z.infer<typeof ModelsDevProviderSchema>;

const ModelsDevCatalogSchema = z.record(z.string(), ModelsDevProviderSchema);

export type ModelsDevCatalog = z.infer<typeof ModelsDevCatalogSchema>;
function cachedProviderModels(
  cachedModels: readonly AgentChatModelDefinition[] | null,
  provider: AgentChatModelDefinition["provider"],
): AgentChatModelDefinition[] | null {
  const models = cachedModels?.filter((model) => model.provider === provider);
  return models?.length ? models : null;
}
function openRouterFallback(
  availability: ModelAvailability,
): AgentChatModelDefinition {
  return {
    modelKey: "openrouter:openai/gpt-4o-mini",
    provider: "openrouter",
    providerModelId: "openai/gpt-4o-mini",
    adapter: "openrouter",
    label: "GPT-4o Mini",
    description: "Fast general-purpose text and tool model · 128K ctx",
    enabled: false,
    availability,
    isDefault: true,
    capabilities: {
      tools: true,
      reasoning: false,
      images: true,
      attachments: true,
      webSearch: true,
    },
    providerToolProfile: "none",
    contextWindowTokens: 128_000,
    providerMaxOutputTokens: 16_384,
    maxOutputTokens: APPLICATION_MAX_OUTPUT_TOKENS,
    pricing: {
      inputUsdMicrosPerMillion: 150_000,
      outputUsdMicrosPerMillion: 600_000,
      pricingRevision: "openrouter-live",
    },
  };
}
function openCodeFallback(
  availability: ModelAvailability,
): AgentChatModelDefinition {
  return {
    modelKey: "opencode:gpt-5-nano",
    provider: "opencode",
    providerModelId: "gpt-5-nano",
    adapter: "opencode-openai-responses",
    label: "GPT 5 Nano",
    description: "OpenCode Zen model catalog unavailable",
    enabled: false,
    availability,
    isDefault: false,
    capabilities: {
      tools: true,
      reasoning: true,
      images: true,
      attachments: true,
      webSearch: false,
    },
    providerToolProfile: "none",
    contextWindowTokens: 400_000,
    providerMaxOutputTokens: 128_000,
    maxOutputTokens: APPLICATION_MAX_OUTPUT_TOKENS,
    pricing: {
      inputUsdMicrosPerMillion: 50_000,
      outputUsdMicrosPerMillion: 400_000,
      pricingRevision: "opencode-development-catalog",
    },
  };
}
function safePricingNumber(value: bigint): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function usdMicrosPerMillionFromPerTokenUsd(value: string): number | null {
  try {
    // USD/token × 1,000,000 tokens × 1,000,000 micro-USD/USD = scale 12.
    return safePricingNumber(decimalAmountToScaledInteger(value, 12));
  } catch {
    return null;
  }
}
function usdMicrosPerMillionFromUsd(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  try {
    return safePricingNumber(usdAmountToMicros(value));
  } catch {
    return null;
  }
}
function formatContext(tokens: number): string {
  return tokens >= 1_000_000
    ? `${Math.round(tokens / 1_000_000)}M`
    : `${Math.round(tokens / 1_000)}K`;
}
function mapOpenRouterModel(
  raw: OpenRouterModel,
): AgentChatModelDefinition | null {
  // OpenRouter is the catalog source of truth. Provider and model IDs are
  // deliberately not curated here; only runtime compatibility is validated.
  const input = raw.architecture?.input_modalities ?? ["text"];
  const output = raw.architecture?.output_modalities ?? ["text"];
  const inputPrice = usdMicrosPerMillionFromPerTokenUsd(raw.pricing.prompt);
  const outputPrice = usdMicrosPerMillionFromPerTokenUsd(
    raw.pricing.completion,
  );
  if (
    !input.includes("text") ||
    !output.includes("text") ||
    inputPrice === null ||
    outputPrice === null ||
    !Number.isFinite(raw.context_length) ||
    raw.context_length < 8_192
  ) {
    return null;
  }
  const supported = raw.supported_parameters ?? [];
  const images = input.some((item) => item === "image" || item === "video");
  const context = Math.min(raw.context_length, 2_000_000);
  const providerOutputLimit = Math.min(
    raw.top_provider?.max_completion_tokens ?? 4_096,
    context,
  );
  const outputLimit = Math.min(
    providerOutputLimit,
    APPLICATION_MAX_OUTPUT_TOKENS,
  );
  const flags = [
    `${formatContext(context)} ctx`,
    supported.includes("tools") ? "tools" : "text only",
    "web search",
    images ? "vision" : "",
    inputPrice === 0 && outputPrice === 0 ? "free" : "",
  ].filter(Boolean);
  return {
    modelKey: `openrouter:${raw.id}`,
    provider: "openrouter",
    providerModelId: raw.id,
    adapter: "openrouter",
    label: (raw.name ?? raw.id).replace(/\s*\(free\)\s*/i, "").trim(),
    description: flags.join(" · "),
    enabled: true,
    availability: "available",
    isDefault: raw.id === "openai/gpt-4o-mini",
    capabilities: {
      tools: supported.includes("tools"),
      reasoning:
        supported.includes("reasoning") ||
        supported.includes("reasoning_effort"),
      images,
      attachments: images,
      webSearch: true,
    },
    providerToolProfile: "none",
    contextWindowTokens: context,
    providerMaxOutputTokens: providerOutputLimit,
    maxOutputTokens: outputLimit,
    pricing: {
      inputUsdMicrosPerMillion: inputPrice,
      outputUsdMicrosPerMillion: outputPrice,
      pricingRevision: "openrouter-live",
    },
  };
}
export function resolveOpenCodeAdapter(
  modelId: string,
  npmPackage?: string,
): AgentChatModelAdapter {
  switch (npmPackage) {
    case "@ai-sdk/openai":
      return "opencode-openai-responses";
    case "@ai-sdk/anthropic":
      return "opencode-anthropic-messages";
    case "@ai-sdk/google":
      return "opencode-google";
    case "@ai-sdk/openai-compatible":
      return "opencode-openai-compatible";
    default:
      // Mirrors OpenCode Zen's documented endpoint families when Models.dev
      // does not yet expose a model-level provider package override.
      if (modelId.startsWith("gpt-")) return "opencode-openai-responses";
      if (modelId.startsWith("claude-") || modelId.startsWith("qwen")) {
        return "opencode-anthropic-messages";
      }
      if (modelId.startsWith("gemini-")) return "opencode-google";
      return "opencode-openai-compatible";
  }
}
function mapOpenCodeModel(params: {
  modelId: string;
  metadata: ModelsDevModel;
  enabled: boolean;
}): AgentChatModelDefinition | null {
  const { modelId, metadata, enabled } = params;
  const input = metadata.modalities?.input ?? ["text"];
  const output = metadata.modalities?.output ?? ["text"];
  const inputPrice = usdMicrosPerMillionFromUsd(metadata.cost?.input);
  const outputPrice = usdMicrosPerMillionFromUsd(metadata.cost?.output);
  const reasoningPrice = usdMicrosPerMillionFromUsd(metadata.cost?.reasoning);
  const cachedInputPrice = usdMicrosPerMillionFromUsd(
    metadata.cost?.cache_read,
  );
  const cacheWritePrice = usdMicrosPerMillionFromUsd(
    metadata.cost?.cache_write,
  );
  const rawContext = metadata.limit?.context;
  if (
    metadata.status === "deprecated" ||
    !input.includes("text") ||
    !output.includes("text") ||
    inputPrice === null ||
    outputPrice === null ||
    typeof rawContext !== "number" ||
    !Number.isFinite(rawContext) ||
    rawContext < 8_192
  ) {
    return null;
  }
  const context = Math.min(rawContext, 2_000_000);
  const providerOutputLimit = Math.min(
    metadata.limit?.output ?? 4_096,
    context,
  );
  const outputLimit = Math.min(
    providerOutputLimit,
    APPLICATION_MAX_OUTPUT_TOKENS,
  );
  const maxInputTokens = typeof metadata.limit?.input === "number"
    && Number.isFinite(metadata.limit.input)
    && metadata.limit.input > 0
      ? Math.min(metadata.limit.input, context)
      : undefined;
  const images = input.some((item) => ["image", "video", "pdf"].includes(item));
  const flags = [
    `${formatContext(context)} ctx`,
    metadata.tool_call ? "tools" : "text only",
    images ? "vision" : "",
    inputPrice === 0 && outputPrice === 0 ? "free" : "",
  ].filter(Boolean);
  return {
    modelKey: `opencode:${modelId}`,
    provider: "opencode",
    providerModelId: modelId,
    adapter: resolveOpenCodeAdapter(modelId, metadata.provider?.npm),
    label: (metadata.name ?? modelId).replace(/\s*\(free\)\s*/i, "").trim(),
    description: flags.join(" · "),
    enabled,
    availability: enabled ? "available" : "misconfigured",
    isDefault: false,
    capabilities: {
      tools: metadata.tool_call === true,
      reasoning: metadata.reasoning === true,
      images,
      attachments: metadata.attachment === true || images,
      webSearch: false,
    },
    providerToolProfile: "none",
    contextWindowTokens: context,
    ...(maxInputTokens ? { maxInputTokens } : {}),
    providerMaxOutputTokens: providerOutputLimit,
    maxOutputTokens: outputLimit,
    pricing: {
      inputUsdMicrosPerMillion: inputPrice,
      outputUsdMicrosPerMillion: outputPrice,
      ...(reasoningPrice !== null
        ? { reasoningUsdMicrosPerMillion: reasoningPrice }
        : {}),
      ...(cachedInputPrice !== null
        ? { cachedInputUsdMicrosPerMillion: cachedInputPrice }
        : {}),
      ...(cacheWritePrice !== null
        ? { cacheWriteUsdMicrosPerMillion: cacheWritePrice }
        : {}),
      pricingRevision: "opencode-development-catalog",
    },
  };
}
async function fetchOpenRouterModels(
  cachedModels: readonly AgentChatModelDefinition[] | null,
): Promise<AgentChatModelDefinition[]> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return [openRouterFallback("misconfigured")];
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`OpenRouter model registry returned ${response.status}`);
    }
    const payload = await parseBoundedJsonBody(
      response,
      OpenRouterModelListSchema,
      8 * 1024 * 1024,
    );
    const models = (payload.data ?? [])
      .map(mapOpenRouterModel)
      .filter((model): model is AgentChatModelDefinition => model !== null);
    if (!models.length) {
      throw new Error("No compatible OpenRouter models were returned");
    }
    return models;
  } catch (error) {
    console.error("[agent-chat] OpenRouter model discovery failed", { error: safeErrorDetails(error) });
    return (
      cachedProviderModels(cachedModels, "openrouter") ?? [
        openRouterFallback("temporarily_unavailable"),
      ]
    );
  }
}
async function fetchOpenCodeModels(
  cachedModels: readonly AgentChatModelDefinition[] | null,
): Promise<AgentChatModelDefinition[]> {
  const key = process.env.OPENCODE_API_KEY?.trim();
  const baseUrl = (
    process.env.OPENCODE_BASE_URL?.trim() || DEFAULT_OPENCODE_BASE_URL
  ).replace(/\/+$/, "");
  try {
    const [catalogResponse, metadataResponse] = await Promise.all([
      fetch(`${baseUrl}/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
        signal: AbortSignal.timeout(10_000),
      }),
      fetch(MODELS_DEV_API_URL, {
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    if (!catalogResponse.ok) {
      throw new Error(
        `OpenCode Zen model registry returned ${catalogResponse.status}`,
      );
    }
    if (!metadataResponse.ok) {
      throw new Error(
        `Models.dev registry returned ${metadataResponse.status}`,
      );
    }
    const [catalogPayload, metadataPayload] = await Promise.all([
      parseBoundedJsonBody(
        catalogResponse,
        OpenCodeCatalogResponseSchema,
        4 * 1024 * 1024,
      ),
      parseBoundedJsonBody(
        metadataResponse,
        ModelsDevCatalogSchema,
        16 * 1024 * 1024,
      ),
    ]);
    const provider = metadataPayload.opencode;
    const metadataModels = provider?.models ?? {};
    const liveIds = new Set(
      (catalogPayload.data ?? [])
        .map((model) => model.id.trim())
        .filter((id): id is string => Boolean(id)),
    );
    const models = [...liveIds]
      .map((modelId) => {
        const metadata = metadataModels[modelId];
        if (!metadata) return null;
        return mapOpenCodeModel({ modelId, metadata: metadata as ModelsDevModel, enabled: Boolean(key) });
      })
      .filter((model): model is AgentChatModelDefinition => model !== null);
    if (!models.length) {
      throw new Error("No compatible OpenCode Zen models were returned");
    }
    return models;
  } catch (error) {
    console.error("[agent-chat] OpenCode Zen model discovery failed", {
      error: safeErrorDetails(error),
    });
    return (
      cachedProviderModels(cachedModels, "opencode") ?? [
        openCodeFallback(key ? "temporarily_unavailable" : "misconfigured"),
      ]
    );
  }
}
function sortModels(
  left: AgentChatModelDefinition,
  right: AgentChatModelDefinition,
): number {
  if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
  if (left.provider !== right.provider) {
    return left.provider.localeCompare(right.provider);
  }
  if (left.capabilities.tools !== right.capabilities.tools) {
    return left.capabilities.tools ? -1 : 1;
  }
  const leftCost =
    left.pricing.inputUsdMicrosPerMillion +
    left.pricing.outputUsdMicrosPerMillion;
  const rightCost =
    right.pricing.inputUsdMicrosPerMillion +
    right.pricing.outputUsdMicrosPerMillion;
  return leftCost - rightCost || left.label.localeCompare(right.label);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}
function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
function isOptionalNonNegativeFinite(value: unknown): boolean {
  return value === undefined || isNonNegativeFinite(value);
}
function isModelDefinition(value: unknown): value is AgentChatModelDefinition {
  if (!isRecord(value) || !isRecord(value.capabilities) || !isRecord(value.pricing)) return false;
  const provider = value.provider;
  const adapter = value.adapter;
  const availability = value.availability;
  return (
    isBoundedString(value.modelKey, 512) &&
    (provider === "openrouter" || provider === "opencode") &&
    isBoundedString(value.providerModelId, 512) &&
    [
      "openrouter",
      "opencode-openai-responses",
      "opencode-anthropic-messages",
      "opencode-google",
      "opencode-openai-compatible",
    ].includes(String(adapter)) &&
    isBoundedString(value.label, 512) &&
    typeof value.description === "string" && value.description.length <= 4_096 &&
    typeof value.enabled === "boolean" &&
    (availability === undefined || ["available", "misconfigured", "temporarily_unavailable"].includes(String(availability))) &&
    typeof value.isDefault === "boolean" &&
    typeof value.capabilities.tools === "boolean" &&
    typeof value.capabilities.reasoning === "boolean" &&
    typeof value.capabilities.images === "boolean" &&
    typeof value.capabilities.attachments === "boolean" &&
    typeof value.capabilities.webSearch === "boolean" &&
    ["none", "openai-responses", "anthropic-messages", "google-generative-ai"].includes(String(value.providerToolProfile)) &&
    (value.catalogFreshness === undefined || ["fresh", "stale"].includes(String(value.catalogFreshness))) &&
    (value.catalogFetchedAt === undefined || typeof value.catalogFetchedAt === "string") &&
    isPositiveSafeInteger(value.contextWindowTokens) &&
    (value.maxInputTokens === undefined || isPositiveSafeInteger(value.maxInputTokens)) &&
    isPositiveSafeInteger(value.providerMaxOutputTokens) &&
    isPositiveSafeInteger(value.maxOutputTokens) &&
    value.maxOutputTokens <= value.providerMaxOutputTokens &&
    value.providerMaxOutputTokens <= value.contextWindowTokens &&
    isNonNegativeFinite(value.pricing.inputUsdMicrosPerMillion) &&
    isNonNegativeFinite(value.pricing.outputUsdMicrosPerMillion) &&
    isOptionalNonNegativeFinite(value.pricing.cachedInputUsdMicrosPerMillion) &&
    isOptionalNonNegativeFinite(value.pricing.cacheWriteUsdMicrosPerMillion) &&
    isOptionalNonNegativeFinite(value.pricing.reasoningUsdMicrosPerMillion) &&
    isBoundedString(value.pricing.pricingRevision, 256)
  );
}
function isModelRegistry(value: unknown): value is AgentChatModelDefinition[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 20_000 && value.every(isModelDefinition);
}
function modelRegistryCacheKey(): string {
  const configuration = JSON.stringify({
    openrouterEnabled: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    opencodeEnabled: Boolean(process.env.OPENCODE_API_KEY?.trim()),
    opencodeBaseUrl: (process.env.OPENCODE_BASE_URL?.trim() || DEFAULT_OPENCODE_BASE_URL).replace(/\/+$/, ""),
  });
  return `agent-chat:model-registry:${createHash("sha256").update(configuration).digest("hex").slice(0, 16)}`;
}
async function fetchModels(
  cachedModels: readonly AgentChatModelDefinition[] | null,
): Promise<AgentChatModelDefinition[]> {
  const providerModels = await Promise.all([
    fetchOpenRouterModels(cachedModels),
    fetchOpenCodeModels(cachedModels),
  ]);
  const models = providerModels.flat().sort(sortModels);
  if (!models.some((model) => model.enabled && model.isDefault)) {
    const firstEnabled = models.find((model) => model.enabled);
    if (firstEnabled) firstEnabled.isDefault = true;
  }
  return models;
}
async function registry(): Promise<AgentChatModelDefinition[]> {
  const key = modelRegistryCacheKey();
  const cached = await readExternalProviderCache({
    key,
    validate: isModelRegistry,
    freshTtlSeconds: CACHE_FRESH_TTL_SECONDS,
    staleTtlSeconds: CACHE_STALE_TTL_SECONDS,
    maxPayloadBytes: CACHE_MAX_PAYLOAD_BYTES,
  });
  if (cached?.status === "fresh") return cached.value;
  if (!inflight) {
    inflight = fetchModels(cached?.value ?? null)
      .then(async (models) => {
        await writeExternalProviderCache({
          key,
          value: models,
          validate: isModelRegistry,
          freshTtlSeconds: CACHE_FRESH_TTL_SECONDS,
          staleTtlSeconds: CACHE_STALE_TTL_SECONDS,
          maxPayloadBytes: CACHE_MAX_PAYLOAD_BYTES,
        });
        return models;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
export async function getModelOrThrow(
  modelKey: string,
  options: { appAccountId?: string } = {},
): Promise<AgentChatModelDefinition> {
  const platformModel = (await registry()).find((item) => item.modelKey === modelKey);
  const model = platformModel ?? (options.appAccountId
    ? await resolveByokModel(options.appAccountId, modelKey)
    : null);
  if (!model) {
    throw new HttpError(
      400,
      "INVALID_MODEL",
      "The selected model is no longer available for this account",
    );
  }
  if (!model.enabled || model.availability !== "available") {
    throw new HttpError(
      503,
      "MODEL_UNAVAILABLE",
      model.credentialSource === "byok"
        ? "Your provider model is temporarily unavailable. Check the provider key and quota in Settings."
        : "The model provider is not configured or temporarily unavailable",
      true,
      "RETRY",
    );
  }
  return model;
}
export async function getAvailableModels(
  options: { appAccountId?: string } = {},
): Promise<AgentChatModelDefinition[]> {
  const platformModels = await registry();
  if (!options.appAccountId) return platformModels;
  const byokModels = await getAccountByokModels(options.appAccountId);
  return [...platformModels, ...byokModels].sort(sortModels);
}
/** List all enabled, available models visible to the current account. */
export async function listCompatibleModels(
  options: { appAccountId?: string } = {},
): Promise<readonly AgentChatModelDefinition[]> {
  const models = await getAvailableModels(options);
  return models.filter((m) => m.enabled && m.availability === "available");
}
