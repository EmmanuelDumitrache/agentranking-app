import "server-only";

import {
  modelInputLimitForOutput,
  type AgentChatModelDefinition,
} from "../shared/model-registry-types";
import { getModelOrThrow, listCompatibleModels } from "./model-registry";

/**
 * Preferred platform model for context-control work when the parent run itself
 * is platform billed. User-owned runs must never silently cross into this lane.
 */
export const AGENT_CONTEXT_CONTROL_MODEL_KEY = "openrouter:openai/gpt-4o-mini";

export type AgentContextControlLane = "platform" | "user";
export type AgentContextControlProviderFallback = "lane" | "same-provider";

export function controlLaneForModel(model: AgentChatModelDefinition): AgentContextControlLane {
  return model.credentialSource === "byok" || model.billingOwner === "user"
    ? "user"
    : "platform";
}

export function controlLaneForModelKey(modelKey: string): AgentContextControlLane {
  return modelKey.startsWith("byok:") ? "user" : "platform";
}

function credentialProvider(model: AgentChatModelDefinition): string {
  return model.credentialProvider ?? model.provider;
}

/**
 * The shared semantic-ranker uses the platform OpenRouter embedding client.
 * Only let it run when the parent model already uses that same physical
 * platform provider; a generic "platform" billing lane is not provider
 * affinity and must not couple OpenCode/OpenAI/etc. runs to OpenRouter quota.
 */
export function canUsePlatformSemanticRanking(
  model: AgentChatModelDefinition,
): boolean {
  return controlLaneForModel(model) === "platform"
    && credentialProvider(model) === "openrouter";
}

function modelCost(model: AgentChatModelDefinition): number {
  return model.pricing.inputUsdMicrosPerMillion
    + model.pricing.outputUsdMicrosPerMillion;
}

function isControlCandidate(
  model: AgentChatModelDefinition,
  lane: AgentContextControlLane,
  minContextTokens: number,
  minOutputTokens: number,
): boolean {
  return controlLaneForModel(model) === lane
    && modelInputLimitForOutput(model, minOutputTokens) >= minContextTokens
    && model.providerMaxOutputTokens >= minOutputTokens
    && model.maxOutputTokens >= Math.min(minOutputTokens, model.providerMaxOutputTokens);
}

/**
 * Resolve a cheap auxiliary model without crossing the parent conversation's
 * billing/routing lane. Prefer the same physical provider first for both
 * platform and BYOK runs so auxiliary work does not unexpectedly consume a
 * second provider's quota. The parent's model is the final same-provider safe
 * fallback when it already satisfies the auxiliary workload.
 */
export async function resolveAgentContextControlModel(params: {
  appAccountId?: string;
  preferredModel?: AgentChatModelDefinition;
  preferredLane?: AgentContextControlLane;
  minContextTokens?: number;
  minOutputTokens?: number;
  /**
   * `same-provider` prevents auxiliary work from silently consuming a second
   * provider's quota. Memory extraction uses this because it is background
   * work derived from a run that already proved its provider is usable.
   */
  providerFallback?: AgentContextControlProviderFallback;
} = {}): Promise<AgentChatModelDefinition> {
  const minContextTokens = Math.max(8_192, Math.trunc(params.minContextTokens ?? 16_384));
  const minOutputTokens = Math.max(256, Math.trunc(params.minOutputTokens ?? 1_024));
  const lane = params.preferredModel
    ? controlLaneForModel(params.preferredModel)
    : (params.preferredLane ?? "platform");
  const accountOptions = params.appAccountId
    ? { appAccountId: params.appAccountId }
    : {};
  if (params.providerFallback === "same-provider" && !params.preferredModel) {
    throw new Error("Same-provider context-control routing requires a preferred model");
  }

  let models: readonly AgentChatModelDefinition[];
  try {
    models = await listCompatibleModels(accountOptions);
  } catch {
    if (
      params.preferredModel
      && isControlCandidate(
        params.preferredModel,
        lane,
        minContextTokens,
        minOutputTokens,
      )
    ) {
      return params.preferredModel;
    }
    if (params.providerFallback === "same-provider") {
      throw new Error("No same-provider context-control model is available");
    }
    if (lane === "user") throw new Error("No user-owned context-control model is available");
    return getModelOrThrow(AGENT_CONTEXT_CONTROL_MODEL_KEY, accountOptions);
  }

  const candidates = models.filter((model) =>
    isControlCandidate(model, lane, minContextTokens, minOutputTokens));
  const preferredProvider = params.preferredModel
    ? credentialProvider(params.preferredModel)
    : null;
  const sortCandidates = (values: readonly AgentChatModelDefinition[]) =>
    [...values].sort((left, right) => {
      const costDelta = modelCost(left) - modelCost(right);
      if (costDelta !== 0) return costDelta;
      // Prefer smaller capable contexts for auxiliary work: large-context models
      // are reserved for the parent when a cheaper compacting model is adequate.
      if (left.contextWindowTokens !== right.contextWindowTokens) {
        return left.contextWindowTokens - right.contextWindowTokens;
      }
      return left.modelKey.localeCompare(right.modelKey);
    });

  // Provider affinity comes before the generic platform control model. This
  // avoids the old OpenCode -> OpenRouter quota coupling: a run that completed
  // successfully on one provider should keep its auxiliary work on that
  // provider whenever a capable model is available there.
  if (preferredProvider) {
    const sameProvider = candidates.filter(
      (model) => credentialProvider(model) === preferredProvider,
    );
    if (sameProvider.length > 0) return sortCandidates(sameProvider)[0]!;
    if (
      params.preferredModel
      && isControlCandidate(
        params.preferredModel,
        lane,
        minContextTokens,
        minOutputTokens,
      )
    ) {
      return params.preferredModel;
    }
    if (params.providerFallback === "same-provider") {
      throw new Error(
        `No same-provider context-control model is available for ${preferredProvider}`,
      );
    }
  }

  if (candidates.length === 0) {
    if (lane === "user") throw new Error("No user-owned context-control model is available");
    return getModelOrThrow(AGENT_CONTEXT_CONTROL_MODEL_KEY, accountOptions);
  }

  if (lane === "platform") {
    const preferredPlatform = candidates.find(
      (model) => model.modelKey === AGENT_CONTEXT_CONTROL_MODEL_KEY,
    );
    if (preferredPlatform) return preferredPlatform;
  }

  return sortCandidates(candidates)[0]!;
}
