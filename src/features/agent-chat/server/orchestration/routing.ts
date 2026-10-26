import "server-only";

import {
  modelInputLimitForOutput,
  type AgentChatModelDefinition,
} from "../../shared/model-registry-types";
import type {
  AgentTaskProfile,
  AgentRoutingPlan,
  AgentRoutingRequirements,
  AgentRouteReason,
} from "./types";
import { listCompatibleModels, getModelOrThrow } from "../model-registry";
import { HttpError } from "../http-error";

const MAX_ROUTE_FALLBACKS = 5;
const MODEL_ID_AFFINITY_BONUS = 900;
const PROVIDER_AFFINITY_BONUS = 500;
const ADAPTER_AFFINITY_BONUS = 240;
const TOOL_PROFILE_AFFINITY_BONUS = 120;

export function routingLane(model: AgentChatModelDefinition): string {
  if (model.credentialSource === "byok" || model.billingOwner === "user") {
    return "byok:user";
  }
  return "platform";
}

function sameRoutingLane(
  left: AgentChatModelDefinition,
  right: AgentChatModelDefinition,
): boolean {
  return routingLane(left) === routingLane(right);
}

export function modelSatisfiesRoutingRequirements(
  model: AgentChatModelDefinition,
  req: AgentRoutingRequirements,
  currentInputTokens = req.estimatedInputTokens,
): boolean {
  if (req.requiresTools && !model.capabilities.tools) return false;
  if (req.requiresVision && !model.capabilities.images) return false;
  if (req.webSearch && !model.capabilities.webSearch) return false;
  if (model.providerMaxOutputTokens < Math.max(0, req.reservedOutputTokens)) return false;
  const requiredInput = Math.max(1, currentInputTokens) + Math.max(0, req.reservedToolTokens);
  return modelInputLimitForOutput(model, req.reservedOutputTokens) >= requiredInput;
}

export async function buildAgentRoutingPlan(
  params: {
    requestedModelKey: string;
    profile: AgentTaskProfile;
    appAccountId?: string;
    estimatedInputTokens: number;
    reservedOutputTokens: number;
    reservedToolTokens: number;
  },
  deps?: {
    getModelOrThrow: typeof getModelOrThrow;
    listCompatibleModels: typeof listCompatibleModels;
  },
): Promise<AgentRoutingPlan> {
  const resolveModel = deps?.getModelOrThrow ?? getModelOrThrow;
  const listModels = deps?.listCompatibleModels ?? listCompatibleModels;
  const accountOptions = params.appAccountId ? { appAccountId: params.appAccountId } : {};
  const requestedModel = await resolveModel(params.requestedModelKey, accountOptions);
  const allModels = await listModels(accountOptions);
  const requirements: AgentRoutingRequirements = {
    requiresTools: params.profile.requiresTools,
    requiresVision: params.profile.requiresVision,
    prefersReasoning: params.profile.prefersReasoning,
    estimatedInputTokens: Math.max(1, Math.trunc(params.estimatedInputTokens)),
    reservedOutputTokens: Math.max(0, Math.trunc(params.reservedOutputTokens)),
    reservedToolTokens: Math.max(0, Math.trunc(params.reservedToolTokens)),
    webSearch: params.profile.requiresCurrentWeb,
  };
  const requestedCompat = modelSatisfiesRoutingRequirements(requestedModel, requirements);
  let reason: AgentRouteReason;
  let primaryModel: AgentChatModelDefinition;
  if (requestedCompat) {
    reason = "REQUESTED_MODEL_COMPATIBLE";
    primaryModel = requestedModel;
  } else if (requirements.requiresTools && !requestedModel.capabilities.tools) {
    reason = "REQUESTED_MODEL_LACKS_TOOLS";
    primaryModel = requireBestCompatible(allModels, requirements, requestedModel);
  } else if (requirements.requiresVision && !requestedModel.capabilities.images) {
    reason = "REQUESTED_MODEL_LACKS_VISION";
    primaryModel = requireBestCompatible(allModels, requirements, requestedModel);
  } else if (requirements.webSearch && !requestedModel.capabilities.webSearch) {
    reason = "REQUESTED_MODEL_LACKS_WEB_SEARCH";
    primaryModel = requireBestCompatible(allModels, requirements, requestedModel);
  } else {
    reason = "INSUFFICIENT_CONTEXT";
    primaryModel = requireBestCompatible(allModels, requirements, requestedModel);
  }
  const fallbackModels = selectFallbacks(allModels, requirements, primaryModel, MAX_ROUTE_FALLBACKS);
  return {
    requestedModel,
    primaryModel,
    fallbackModels,
    reason,
    requirements,
    routingPolicy: "request-demand-capability-cost-lane-cache-affinity:v4",
  };
}

function requireBestCompatible(
  models: readonly AgentChatModelDefinition[],
  req: AgentRoutingRequirements,
  preferred: AgentChatModelDefinition,
): AgentChatModelDefinition {
  const candidates = models
    .filter((model) => model.modelKey !== preferred.modelKey)
    .filter((model) => sameRoutingLane(model, preferred))
    .filter((model) => modelSatisfiesRoutingRequirements(model, req));
  const selected = rankModelsByCacheAffinity(candidates, preferred)[0];
  if (!selected) {
    const byok = routingLane(preferred) === "byok:user";
    throw new HttpError(
      503,
      "PROVIDER_UNAVAILABLE",
      byok
        ? "No connected user-owned model can satisfy this request. BYOK requests are never moved to platform-paid providers."
        : "No configured platform model can satisfy the required tool, vision, web-search, and context capabilities",
      true,
      "RETRY",
    );
  }
  return selected;
}

function credentialProviderKey(model: AgentChatModelDefinition): string {
  return model.credentialProvider ?? model.provider;
}

function selectFallbacks(
  models: readonly AgentChatModelDefinition[],
  req: AgentRoutingRequirements,
  primary: AgentChatModelDefinition,
  count: number,
): readonly AgentChatModelDefinition[] {
  const candidates = models
    .filter((model) => model.modelKey !== primary.modelKey)
    .filter((model) => sameRoutingLane(model, primary))
    .filter((model) => modelSatisfiesRoutingRequirements(model, req));
  const scored = rankModelsByCacheAffinity(candidates, primary);
  if (routingLane(primary) !== "byok:user" || count <= 0) {
    return scored.slice(0, count);
  }

  // Keep provider affinity without letting a large catalog from the selected
  // provider consume every bounded fallback slot. Reserve one best compatible
  // model for each other connected user-owned provider, then spend the
  // remaining slots on same-provider alternatives before filling with further
  // cross-provider models. This keeps the physical candidate set representative
  // of the user's connected provider estate while preserving the requested
  // provider as the first fallback preference.
  const primaryProvider = credentialProviderKey(primary);
  const sameProvider = scored.filter(
    (model) => credentialProviderKey(model) === primaryProvider,
  );
  const otherProviderGroups = new Map<string, AgentChatModelDefinition[]>();
  for (const model of scored) {
    const provider = credentialProviderKey(model);
    if (provider === primaryProvider) continue;
    const group = otherProviderGroups.get(provider);
    if (group) group.push(model);
    else otherProviderGroups.set(provider, [model]);
  }
  const providerRepresentatives = [...otherProviderGroups.values()]
    .map((group) => group[0]!)
    .sort((left, right) => scored.indexOf(left) - scored.indexOf(right));
  const sameProviderSlots = Math.max(0, count - providerRepresentatives.length);
  const selected = [
    ...sameProvider.slice(0, sameProviderSlots),
    ...providerRepresentatives,
  ].slice(0, count);
  const selectedKeys = new Set(selected.map((model) => model.modelKey));
  if (selected.length < count) {
    for (const model of scored) {
      if (selectedKeys.has(model.modelKey)) continue;
      selected.push(model);
      selectedKeys.add(model.modelKey);
      if (selected.length >= count) break;
    }
  }
  return selected;
}

export function rankModelsByCacheAffinity(
  candidates: readonly AgentChatModelDefinition[],
  preferred: AgentChatModelDefinition,
): AgentChatModelDefinition[] {
  const scored = candidates.map((model) => ({ model, score: scoreCandidate(model, preferred) }));
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const aCost = a.model.pricing.inputUsdMicrosPerMillion + a.model.pricing.outputUsdMicrosPerMillion;
    const bCost = b.model.pricing.inputUsdMicrosPerMillion + b.model.pricing.outputUsdMicrosPerMillion;
    if (aCost !== bCost) return aCost - bCost;
    return a.model.modelKey.localeCompare(b.model.modelKey);
  });
  return scored.map((item) => item.model);
}

function scoreCandidate(
  candidate: AgentChatModelDefinition,
  preferred: AgentChatModelDefinition,
): number {
  let score = 0;
  if (candidate.modelKey === preferred.modelKey) score += 1_000;
  // Distinct registry entries can occasionally resolve to the same physical
  // provider model (for example an account-specific alias). Prefer that before
  // crossing a provider model boundary: provider prefix caches are keyed by
  // the physical model/prompt, not by AgentRanking's registry label.
  if (
    candidate.providerModelId === preferred.providerModelId
    && credentialProviderKey(candidate) === credentialProviderKey(preferred)
  ) {
    score += MODEL_ID_AFFINITY_BONUS;
  }
  if (
    (candidate.credentialProvider ?? candidate.provider) ===
    (preferred.credentialProvider ?? preferred.provider)
  ) {
    score += PROVIDER_AFFINITY_BONUS;
  }
  if (candidate.adapter === preferred.adapter) score += ADAPTER_AFFINITY_BONUS;
  if (candidate.providerToolProfile === preferred.providerToolProfile) {
    score += TOOL_PROFILE_AFFINITY_BONUS;
  }
  if (candidate.capabilities.tools) score += 100;
  if (candidate.capabilities.reasoning === preferred.capabilities.reasoning) score += 50;
  else if (candidate.capabilities.reasoning) score += 30;
  const headroom = modelInputLimitForOutput(candidate, candidate.maxOutputTokens) - 4_096;
  if (headroom > 0) score += Math.min(30, Math.floor(headroom / 8_192));
  if (candidate.isDefault) score += 5;
  const cost = candidate.pricing.inputUsdMicrosPerMillion + candidate.pricing.outputUsdMicrosPerMillion;
  if ((candidate.billingOwner ?? "platform") === "platform") {
    if (cost === 0) score += 20;
    else if (cost < 100) score += 10;
    else if (cost < 500) score += 5;
  }
  return score;
}

export function getEscalationModel(
  routingPlan: AgentRoutingPlan,
  escalationCount: number,
  currentInputTokens = routingPlan.requirements.estimatedInputTokens,
  currentModel?: AgentChatModelDefinition,
): AgentChatModelDefinition | null {
  const startIndex = Math.max(0, escalationCount - 1);
  const compatible = routingPlan.fallbackModels
    .slice(startIndex)
    .filter((model) =>
      model.modelKey !== currentModel?.modelKey
      && modelSatisfiesRoutingRequirements(
        model,
        routingPlan.requirements,
        currentInputTokens,
      ),
    );
  if (compatible.length === 0) return null;

  // Once a physical run is underway, re-rank escalation candidates relative
  // to the model that owns the current prompt cache rather than the original
  // route primary. This avoids provider/model-family ping-pong across retries
  // when a same-provider compatible escalation exists. The fallback ordering
  // remains authoritative for callers that do not have a current physical
  // model (including older unit-level consumers of this helper).
  if (currentModel) {
    return rankModelsByCacheAffinity(compatible, currentModel)[0] ?? null;
  }
  return compatible[0] ?? null;
}
