import type { AgentChatModelProvider } from "./model-registry-types";
import type { z } from "zod";
import type { agentChatStreamRequestSchema, mcpContinuationResponseSchema } from "./schemas";
import type { AgentChatUIMessage } from "./ui-message";
export type AgentChatScope = {
  appAccountId: string;
  userProfileId: number;
  agentDbId: number;
};
export type AgentChatAccess = AgentChatScope & {
  balanceCents: number;
  settings: {
    revisionId: string | null;
    revision: number;
    enabled: boolean;
    persona: string | null;
    systemInstructions: string | null;
    greeting: string | null;
  };
};
export type AgentChatStreamRequest = z.infer<typeof agentChatStreamRequestSchema>;
export type McpContinuationResponse = z.infer<typeof mcpContinuationResponseSchema>;
export type ConversationSummary = {
  id: string;
  title: string;
  titleSource: "USER" | "GENERATED" | "DEFAULT";
  status: string;
  defaultModelKey: string;
  lastMessageAt: string;
  createdAt: string;
};
export type AgentChatRunSummary = {
  id: string;
  status: string;
  settlementStatus: string;
  modelKey: string;
  reservedCents: number;
  finalChargeCents: number | null;
  refundCents: number | null;
  startedAt: string;
  completedAt: string | null;
};
export type ConversationListResponse = {
  items: ConversationSummary[];
  nextCursor: string | null;
};
export type ConversationDetailResponse = {
  conversation: ConversationSummary;
  messages: AgentChatUIMessage[];
  previousCursor: number | null;
  activeRun: AgentChatRunSummary | null;
};
export type RunStatusResponse = AgentChatRunSummary;
export type CancelRunResponse = {
  runId: string;
  status: string;
  cancellationRequested: boolean;
};
export type CreditBalanceResponse = {
  availableCents: number;
  reservedCents: number;
  lastLedgerAt: string | null;
};
export type ModelAvailability =
  | "available"
  | "misconfigured"
  | "temporarily_unavailable";
export type ClientModelOption = {
  modelKey: string;
  provider: AgentChatModelProvider;
  providerLabel: string;
  label: string;
  description: string;
  capabilities: {
    tools: boolean;
    reasoning: boolean;
    images: boolean;
    attachments: boolean;
    webSearch: boolean;
  };
  isFree: boolean;
  isDefault: boolean;
  credentialSource: "platform" | "byok";
  billingOwner: "platform" | "user";
  billingLabel: string;
  pricing: {
    inputPerMillionCents: number;
    outputPerMillionCents: number;
  };
  availability: ModelAvailability;
};
export type ModelsListResponse = {
  models: ClientModelOption[];
};