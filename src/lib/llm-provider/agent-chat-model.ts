import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel, ToolSet } from "ai";
import type { AgentChatModelDefinition } from "@/features/agent-chat/shared/model-registry-types";
import type { ProviderModelRuntime } from "./credentials/provider-adapter";
import { resolveByokRuntime } from "./credentials/service";
import { normalizeOpenCodeRequestBody } from "./opencode-request-normalization";
import { openrouter } from "./openrouter";
import { createProviderRuntimeFailure } from "./provider-failure";

const OPENCODE_BASE_URL = (
  process.env.OPENCODE_BASE_URL?.trim() || "https://opencode.ai/zen/v1"
).replace(/\/+$/, "");
const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY?.trim();

const openCodeOpenAI = createOpenAI({
  apiKey: OPENCODE_API_KEY,
  baseURL: OPENCODE_BASE_URL,
});
const openCodeAnthropic = createAnthropic({
  apiKey: OPENCODE_API_KEY,
  baseURL: OPENCODE_BASE_URL,
});
const openCodeGoogle = createGoogleGenerativeAI({
  apiKey: OPENCODE_API_KEY,
  baseURL: OPENCODE_BASE_URL,
});
const openCodeCompatible = createOpenAICompatible({
  name: "opencode",
  apiKey: OPENCODE_API_KEY,
  baseURL: OPENCODE_BASE_URL,
  includeUsage: true,
  transformRequestBody: normalizeOpenCodeRequestBody,
});

function getPlatformRuntime(
  model: AgentChatModelDefinition,
): ProviderModelRuntime {
  if (model.provider === "openrouter") {
    const providerTools: ToolSet = model.capabilities.webSearch
      ? {
          web_search: openrouter.tools.webSearch({
            maxResults: 5,
            engine: "auto",
          }) as unknown as ToolSet[string],
        }
      : {};
    return {
      languageModel: openrouter(model.providerModelId) as LanguageModel,
      providerTools,
    };
  }

  if (model.provider === "opencode") {
    let languageModel: LanguageModel;
    switch (model.adapter) {
      case "opencode-openai-responses":
        languageModel = openCodeOpenAI.responses(model.providerModelId) as LanguageModel;
        break;
      case "opencode-anthropic-messages":
        languageModel = openCodeAnthropic.messages(model.providerModelId) as LanguageModel;
        break;
      case "opencode-google":
        languageModel = openCodeGoogle(model.providerModelId) as LanguageModel;
        break;
      case "opencode-openai-compatible":
        languageModel = openCodeCompatible(model.providerModelId) as LanguageModel;
        break;
      default:
        throw new Error(
          `OpenCode model ${model.modelKey} has no supported AI SDK adapter`,
        );
    }
    return { languageModel, providerTools: {} };
  }

  throw new Error(`Unsupported agent chat provider: ${model.provider}`);
}

export function getAgentChatRuntime(
  model: AgentChatModelDefinition,
): ProviderModelRuntime {
  if (model.credentialSource === "byok") {
    throw new Error(`BYOK model ${model.modelKey} requires account-scoped resolution`);
  }
  return getPlatformRuntime(model);
}

export function getAgentChatLanguageModel(
  model: AgentChatModelDefinition,
): LanguageModel {
  return getAgentChatRuntime(model).languageModel;
}

export async function resolveAgentChatRuntime(
  model: AgentChatModelDefinition,
  options: { appAccountId?: string } = {},
): Promise<ProviderModelRuntime> {
  if (model.credentialSource === "byok") {
    if (!options.appAccountId) {
      throw new Error(`BYOK model ${model.modelKey} requires an account-scoped provider credential`);
    }
    const resolved = await resolveByokRuntime({
      appAccountId: options.appAccountId,
      model,
    });
    if (!resolved) {
      throw createProviderRuntimeFailure({
        provider: model.credentialProvider ?? model.provider,
        source: "inference",
        kind: "authentication",
        modelKey: model.modelKey,
        providerModelId: model.providerModelId,
        providerMessage: `Provider credential for ${model.modelKey} is unavailable or revoked`,
        cause: null,
      });
    }
    return {
      languageModel: resolved.languageModel,
      providerTools: resolved.providerTools,
    };
  }
  return getPlatformRuntime(model);
}

export async function resolveAgentChatLanguageModel(
  model: AgentChatModelDefinition,
  options: { appAccountId?: string } = {},
): Promise<LanguageModel> {
  return (await resolveAgentChatRuntime(model, options)).languageModel;
}
