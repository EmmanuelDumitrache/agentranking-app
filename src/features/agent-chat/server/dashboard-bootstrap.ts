import "server-only";
import type {
  AgentChatAccess,
  AgentChatRunSummary,
  ClientModelOption,
  ConversationDetailResponse,
  ConversationListResponse,
  ModelsListResponse,
} from "@/features/agent-chat/shared/contracts";
import type { AgentChatModelProvider } from "@/features/agent-chat/shared/model-registry-types";
import { getAvailableModels } from "@/features/agent-chat/server/model-registry";
import { listConversations, getConversation } from "@/features/agent-chat/server/repositories/conversations";
import { getConversationMessages } from "@/features/agent-chat/server/repositories/messages";
import { getActiveRunForConversation } from "@/features/agent-chat/server/repositories/runs";

function humanizeProviderId(provider: string): string {
  return provider
    .split(/[._-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getProviderLabel(provider: AgentChatModelProvider): string {
  switch (provider) {
    case "openrouter":
      return "OpenRouter";
    case "opencode":
      return "OpenCode Zen";
    case "google":
      return "Google AI Studio key";
    case "openai":
      return "OpenAI key";
    case "anthropic":
      return "Anthropic key";
    case "deepseek":
      return "DeepSeek key";
    default:
      return humanizeProviderId(provider) || "Provider";
  }
}

export async function loadClientModelOptions(
  appAccountId?: string,
): Promise<ModelsListResponse> {
  const models: ClientModelOption[] = (await getAvailableModels({ appAccountId })).map((model) => ({
    modelKey: model.modelKey,
    provider: model.provider,
    providerLabel: getProviderLabel(model.provider),
    label: model.label,
    description: model.description,
    capabilities: model.capabilities,
    isFree:
      model.credentialSource !== "byok"
      && model.pricing.inputUsdMicrosPerMillion === 0
      && model.pricing.outputUsdMicrosPerMillion === 0,
    isDefault: model.isDefault,
    credentialSource: model.credentialSource ?? "platform",
    billingOwner: model.billingOwner ?? "platform",
    billingLabel:
      model.credentialSource === "byok"
        ? "Uses your provider account; provider quota and billing rules apply."
        : "Uses AgentRanking LLM credits.",
    pricing: {
      inputPerMillionCents: model.pricing.inputUsdMicrosPerMillion / 10_000,
      outputPerMillionCents: model.pricing.outputUsdMicrosPerMillion / 10_000,
    },
    availability:
      model.availability
      ?? (model.enabled ? ("available" as const) : ("misconfigured" as const)),
  }));
  return { models };
}

function summarizeRun(
  run: NonNullable<Awaited<ReturnType<typeof getActiveRunForConversation>>>,
): AgentChatRunSummary {
  return {
    id: run.id,
    status: run.status,
    settlementStatus: run.settlementStatus,
    modelKey: run.finalModelKey ?? run.initialModelKey,
    reservedCents: run.reservedCents,
    finalChargeCents: run.finalChargeCents,
    refundCents: run.refundCents,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

export async function loadConversationDetail(
  access: AgentChatAccess,
  conversationId: string,
  before?: number,
  limit?: number,
): Promise<ConversationDetailResponse> {
  const [conversation, messagePage, activeRun] = await Promise.all([
    getConversation(access, conversationId),
    getConversationMessages(access, conversationId, before, limit),
    getActiveRunForConversation(access, conversationId),
  ]);
  return {
    conversation,
    messages: messagePage.messages,
    previousCursor: messagePage.previousCursor,
    activeRun: activeRun ? summarizeRun(activeRun) : null,
  };
}

export type AgentChatBootstrap = {
  models: ModelsListResponse;
  settings: AgentChatAccess["settings"];
  conversations: ConversationListResponse;
  selectedConversationId: string | null;
  selectedConversation: ConversationDetailResponse | null;
};

export async function loadAgentChatBootstrap(
  access: AgentChatAccess,
  options: {
    requestedConversationId?: string | null;
    preferNewConversation?: boolean;
  } = {},
): Promise<AgentChatBootstrap> {
  const [models, conversations] = await Promise.all([
    loadClientModelOptions(access.appAccountId),
    listConversations(access),
  ]);
  const selectedConversationId = options.preferNewConversation
    ? null
    : options.requestedConversationId
      ?? conversations.items.find((item) => item.status === "ACTIVE")?.id
      ?? conversations.items[0]?.id
      ?? null;
  let selectedConversation: ConversationDetailResponse | null = null;
  if (selectedConversationId) {
    try {
      selectedConversation = await loadConversationDetail(access, selectedConversationId);
    } catch {
      // A stale/deleted deep link must not prevent the durable thread list from rendering.
      selectedConversation = null;
    }
  }
  return {
    models,
    settings: access.settings,
    conversations,
    selectedConversationId: selectedConversation?.conversation.id ?? null,
    selectedConversation,
  };
}
