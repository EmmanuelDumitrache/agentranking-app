import "server-only";

import type { LanguageModel, ToolSet } from "ai";
import type { AgentChatModelDefinition } from "@/features/agent-chat/shared/model-registry-types";
import type { LlmProviderDescriptor } from "@/lib/llm-provider/credential-contracts";

export const APPLICATION_BYOK_MAX_OUTPUT_TOKENS = 8_192;

export type ProviderRuntimeContext = {
  inferenceCircuitKey: string;
};

export type ProviderModelRuntime = {
  languageModel: LanguageModel;
  providerTools: ToolSet;
};

export type ProviderCredentialAdapter = {
  descriptor: LlmProviderDescriptor;
  listModels(secret: string, signal?: AbortSignal): Promise<AgentChatModelDefinition[]>;
  createRuntime(
    modelId: string,
    secret: string,
    context: ProviderRuntimeContext,
  ): ProviderModelRuntime;
};

export function userBilledPricing(providerId: string): AgentChatModelDefinition["pricing"] {
  return {
    inputUsdMicrosPerMillion: 0,
    outputUsdMicrosPerMillion: 0,
    pricingRevision: `${providerId}:user-billed`,
  };
}
