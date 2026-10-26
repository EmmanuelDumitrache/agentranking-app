import type { AgentChatModelDefinition } from "../../shared/model-registry-types";
import type { AgentProviderOptions } from "./prompt-cache";

const NATIVE_ANTHROPIC_COMPACTION_MODEL = /(?:^|\/)(?:claude-(?:fable-5|mythos-(?:5|preview)|opus-(?:5|4-[678])|sonnet-(?:5|4-6)))(?:$|[-:])/i;

function usesAnthropicMessages(model: AgentChatModelDefinition): boolean {
  return model.adapter === "anthropic-messages"
    || model.adapter === "opencode-anthropic-messages";
}

function usesDirectOpenAiResponses(model: AgentChatModelDefinition): boolean {
  return model.adapter === "openai-responses"
    && (model.credentialProvider ?? model.provider) === "openai";
}

function supportsOpenAiServerCompaction(model: AgentChatModelDefinition): boolean {
  if (!usesDirectOpenAiResponses(model)) return false;
  const match = /^gpt-(\d+)(?:\.(\d+))?(?:[-:]|$)/i.exec(model.providerModelId);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] == null ? 0 : Number(match[2]);
  return major > 5 || (major === 5 && minor >= 2);
}

/**
 * Provider-native context management is a secondary safety layer. The
 * provider-neutral compiler normally keeps requests below these thresholds;
 * native edits mainly protect against provider tokenizer differences and long
 * tool loops without making provider state canonical.
 */
export function buildProviderContextManagementOptions(params: {
  model: AgentChatModelDefinition;
  usableInputTokens: number;
  /** Tool names whose historical uses must survive provider-native editing. */
  stateChangingToolNames: readonly string[];
}): AgentProviderOptions | undefined {
  const usable = Math.max(8_000, Math.trunc(params.usableInputTokens));

  // AI SDK 7 / @ai-sdk/openai 4 exposes Responses API automatic server-side
  // compaction through providerOptions.openai.contextManagement. OpenAI
  // introduced this context-management generation with GPT-5.2, so restrict it
  // to that/newer direct Responses families. An OpenAI-compatible proxy (or an
  // older direct Responses model) is not evidence of the same wire capability.
  // Local projection/persistent summaries remain canonical; this only absorbs
  // tokenizer drift and provider-side state growth inside a long physical loop.
  if (supportsOpenAiServerCompaction(params.model)) {
    return {
      openai: {
        contextManagement: [
          {
            type: "compaction",
            compactThreshold: Math.max(8_000, Math.floor(usable * 0.9)),
          },
        ],
      },
    };
  }

  if (!usesAnthropicMessages(params.model)) return undefined;
  if (!NATIVE_ANTHROPIC_COMPACTION_MODEL.test(params.model.providerModelId)) {
    return undefined;
  }

  const clearTrigger = Math.max(8_000, Math.floor(usable * 0.72));
  const compactTrigger = Math.max(clearTrigger + 2_000, Math.floor(usable * 0.9));
  // The caller includes both mutation-bearing and failed/error tool names.
  // Anthropic excludes by tool name rather than individual use, so protecting
  // the whole tool is the conservative way to keep exact failure evidence.
  const excluded = [...new Set(params.stateChangingToolNames)].sort();
  return {
    anthropic: {
      contextManagement: {
        edits: [
          {
            type: "clear_tool_uses_20250919",
            trigger: { type: "input_tokens", value: clearTrigger },
            keep: { type: "tool_uses", value: 4 },
            clearAtLeast: {
              type: "input_tokens",
              value: Math.max(1_000, Math.floor(usable * 0.03)),
            },
            clearToolInputs: true,
            ...(excluded.length > 0 ? { excludeTools: excluded } : {}),
          },
          {
            type: "clear_thinking_20251015",
            keep: { type: "thinking_turns", value: 1 },
          },
          {
            type: "compact_20260112",
            trigger: { type: "input_tokens", value: compactTrigger },
            instructions: [
              "Compact only what is necessary to continue the task.",
              "Preserve user constraints, decisions, approvals, pending work, transaction identifiers, artifact IDs, errors, unresolved questions, and the current plan.",
              "Do not invent facts or copy large tool payloads when an artifact ID can preserve an exact-data reference.",
            ].join(" "),
            pauseAfterCompaction: false,
          },
        ],
      },
    },
  };
}
