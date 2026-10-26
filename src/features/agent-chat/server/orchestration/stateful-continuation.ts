import type { ModelMessage, StepResult, ToolSet } from "ai";
import type { AgentChatModelDefinition } from "../../shared/model-registry-types";
import type { AgentProviderOptions } from "./prompt-cache";

export type StatefulContinuationProjection = {
  messages: ModelMessage[];
  providerOptions: AgentProviderOptions;
};

function openAiResponseId(step: StepResult<ToolSet> | undefined): string | null {
  const metadata = step?.providerMetadata as Record<string, unknown> | undefined;
  const openai = metadata?.openai;
  if (!openai || typeof openai !== "object" || Array.isArray(openai)) return null;
  const responseId = (openai as Record<string, unknown>).responseId;
  return typeof responseId === "string" && responseId.length > 0 ? responseId : null;
}

function responseModelId(step: StepResult<ToolSet> | undefined): string | null {
  const response = step?.response as unknown as { modelId?: unknown } | undefined;
  return typeof response?.modelId === "string" && response.modelId.length > 0
    ? response.modelId
    : null;
}

function messagesAfterLastAssistant(messages: readonly ModelMessage[]): ModelMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "assistant") continue;
    return messages.slice(index + 1);
  }
  return [];
}

/**
 * Selectively continue a direct OpenAI Responses tool-loop step from provider
 * state. This is deliberately same-run only: canonical cross-run history stays
 * in AgentRanking and model/provider failover remains portable. Local context
 * reduction always wins over provider-owned state; callers reset the chain when
 * stale observations/history have been masked or dropped.
 */
export function projectOpenAiStatefulContinuation(params: {
  model: AgentChatModelDefinition;
  messages: readonly ModelMessage[];
  steps: Array<StepResult<ToolSet>>;
  enabled: boolean;
  /**
   * False when the local context compiler intentionally removed/masked history
   * that may still exist in the provider-owned response chain. In that case a
   * full projected request must establish a new provider state boundary.
   */
  providerStateReuseSafe: boolean;
}): StatefulContinuationProjection | null {
  if (!params.enabled || !params.providerStateReuseSafe || params.steps.length === 0) return null;
  if (params.model.adapter !== "openai-responses") return null;
  if ((params.model.credentialProvider ?? params.model.provider) !== "openai") return null;

  const previousStep = params.steps.at(-1);
  const previousResponseId = openAiResponseId(previousStep);
  if (!previousResponseId) return null;

  // Do not continue provider state across a model switch. The response model id
  // is authoritative for the preceding SDK step when it is available.
  const previousModelId = responseModelId(previousStep);
  if (!previousModelId || previousModelId !== params.model.providerModelId) return null;

  // The previous response already owns every message through its assistant
  // output. Send only tool/approval continuation material produced after that
  // assistant message, otherwise the previous turns would be duplicated.
  const deltaMessages = messagesAfterLastAssistant(params.messages);
  if (deltaMessages.length === 0) return null;

  return {
    messages: deltaMessages,
    providerOptions: {
      openai: { previousResponseId },
    },
  };
}
