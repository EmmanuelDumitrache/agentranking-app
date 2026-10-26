import type { AgentMemoryPromptFact } from "@/features/agent-memory/shared/types";

// Tool runtime policy (also used by executor)
export type ToolRuntimePolicy = {
  maxToolSteps: number;
  maxToolCallsPerRun: number;
  perToolTimeoutMs: number;
  redactInputForTools: string[];
  modelMaxRetries: number;
  toolRepairMaxAttempts: number;
};
// Agent context loaded for prompt building
export type AgentChatContext = {
  agent: {
    dbId: number;
    name: string;
    description?: string;
    archetype?: string;
    imageUrl?: string;
    chainId?: string;
    tokenAddress?: string;
    verified?: boolean;
  };
  settings: {
    enabled: boolean;
    persona?: string;
    systemInstructions?: string;
    greeting?: string;
  };
  wallet?: {
    publicKey?: string;
    isCustodial?: boolean;
    network?: string;
    solBalanceLamports?: bigint;
  };
  social?: {
    website?: string;
    twitter?: string;
    telegram?: string;
    github?: string;
  };
  memoryFacts?: AgentMemoryPromptFact[];
};
