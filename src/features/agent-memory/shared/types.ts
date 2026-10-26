export const AGENT_MEMORY_FACT_KINDS = [
  "profile",
  "preference",
  "constraint",
  "avoid",
] as const;
export type AgentMemoryFactKind = (typeof AGENT_MEMORY_FACT_KINDS)[number];

export const AGENT_MEMORY_FACT_STATUSES = [
  "pending",
  "active",
  "archived",
  "rejected",
] as const;
export type AgentMemoryFactStatus = (typeof AGENT_MEMORY_FACT_STATUSES)[number];

export type AgentMemoryFactRecord = {
  id: string;
  agentDbId: number;
  appAccountId: string;
  key: string;
  kind: AgentMemoryFactKind;
  content: string;
  status: AgentMemoryFactStatus;
  confidence: number;
  salience: number;
  pinned: boolean;
  sourceRunId: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  firstLearnedAt: string;
  lastConfirmedAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  supersededById: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentMemorySettingsRecord = {
  enabled: boolean;
  requireApproval: boolean;
};

export type AgentMemoryPageData = {
  settings: AgentMemorySettingsRecord;
  facts: {
    active: AgentMemoryFactRecord[];
    pending: AgentMemoryFactRecord[];
  };
  learnedToday: number;
};

export type AgentMemoryPromptFact = {
  id: string;
  key: string;
  kind: AgentMemoryFactKind;
  content: string;
};

export const DEFAULT_AGENT_MEMORY_SETTINGS = {
  enabled: true,
  requireApproval: true,
} as const satisfies AgentMemorySettingsRecord;

/** Independent abuse ceilings; prompt retrieval has a much smaller budget. */
export const AGENT_MEMORY_MAX_LIVE_FACTS = 1_000;
export const AGENT_MEMORY_MAX_STORED_FACTS = 5_000;
export const AGENT_MEMORY_LIST_LIMIT = AGENT_MEMORY_MAX_LIVE_FACTS;
export const AGENT_MEMORY_MAX_EXTRACT_PER_TURN = 3;
export const AGENT_MEMORY_MAX_PROMPT_FACTS = 30;
export const AGENT_MEMORY_MAX_PROMPT_CHARS = 6_000;
export const AGENT_MEMORY_MIN_EXTRACT_CHARS = 3;
export const AGENT_MEMORY_MAX_EXTRACT_INPUT_CHARS = 24_000;
export const AGENT_MEMORY_EXTRACT_CONTEXT_MESSAGES = 6;
