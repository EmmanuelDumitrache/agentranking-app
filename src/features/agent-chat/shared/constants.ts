/**
 * CANONICAL MODULE per roadmap §3.2.
 *
 * src/features/agent-chat owns: conversation UI, chat contracts, model run
 * orchestration, prompt construction, tool execution, and chat persistence.
 * src/lib/llm-provider owns: provider configuration, client creation, usage
 * normalization, and reconciliation. src/lib/llm-credits owns: balance
 * mutations, deposit quoting, transfer validation, and deposit settlement.
 */
export const LLM_CREDIT_REASONS = {
  CHAT_MESSAGE_DEBIT: "CHAT_MESSAGE_DEBIT",
  CHAT_MESSAGE_REFUND: "CHAT_MESSAGE_REFUND",
  CHAT_RUN_RESERVE: "CHAT_RUN_RESERVE",
  CHAT_RUN_FINALIZE: "CHAT_RUN_FINALIZE",
  CHAT_RUN_REFUND: "CHAT_RUN_REFUND",
  CHAT_RUN_SETTLEMENT_REFUND: "CHAT_RUN_SETTLEMENT_REFUND",
  CRYPTO_PURCHASE: "llm_balance_crypto_purchase",
  DEV_GRANT: "llm_balance_dev_grant",
  ADMIN_GRANT: "llm_balance_admin_grant",
} as const;
export const DEFAULT_MAX_TOOL_STEPS = 5;
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_TOOL_CALLS_PER_RUN = 20;
/** Max ACTIVE chat threads per agent (sidebar + create path). */
export const MAX_ACTIVE_CONVERSATIONS_PER_AGENT = 3;
export const OPENROUTER_PROVIDER_LABEL = "openrouter";
export const DEFAULT_MODEL = "openai/gpt-4o-mini";
