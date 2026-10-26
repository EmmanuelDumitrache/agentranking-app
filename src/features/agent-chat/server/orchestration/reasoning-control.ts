import type { AgentChatModelDefinition } from "../../shared/model-registry-types";
import type { AgentStepPhase, AgentTaskProfile } from "./types";
import type { AgentProviderOptions } from "./prompt-cache";

type ReasoningEffort = "low" | "medium" | "high";

function effortFor(
  profile: AgentTaskProfile,
  phase: AgentStepPhase,
): ReasoningEffort {
  // Reasoning is a per-step resource, not a session-wide tax. Tool discovery
  // and execution are usually constrained by schemas/results rather than deep
  // deliberation; reserve the highest effort for the synthesis step where the
  // model integrates evidence. State-changing verification keeps medium effort
  // because missed discrepancies can materially affect the reported outcome.
  if (phase === "SYNTHESIS") {
    if (profile.prefersReasoning || profile.complexity === "high") return "high";
    if (profile.complexity === "medium") return "medium";
    return "low";
  }
  if (phase === "VERIFICATION") {
    if (profile.stateChangingIntent || profile.complexity === "high") return "medium";
    return "low";
  }
  if (phase === "EXECUTION") {
    if (profile.stateChangingIntent || profile.complexity === "high") return "medium";
    return "low";
  }
  // DISCOVERY should spend tokens finding evidence, not repeatedly re-reasoning
  // the whole task before any evidence has arrived.
  return profile.complexity === "high" ? "medium" : "low";
}

function reasoningBudgetTokens(
  effort: ReasoningEffort,
  maxOutputTokens: number | undefined,
): number {
  const requested = effort === "high" ? 8_192 : effort === "medium" ? 4_096 : 1_024;
  if (maxOutputTokens == null || !Number.isFinite(maxOutputTokens)) return requested;
  const output = Math.max(1, Math.trunc(maxOutputTokens));
  // Leave room for a user-visible answer/tool-call envelope. Anthropic-style
  // thinking budgets share the response ceiling, so an 8k thinking request on
  // an 8k-output model is both wasteful and, on some providers, invalid.
  const reasoningCeiling = Math.max(
    1,
    output - Math.min(2_048, Math.floor(output / 4)),
  );
  return Math.min(requested, reasoningCeiling);
}

/**
 * Keep hidden reasoning proportional to the current orchestration phase rather
 * than paying a task's maximum reasoning budget on every tool-loop step.
 * Provider option keys match the AI SDK adapters used by the model registry.
 */
export function buildReasoningProviderOptions(
  model: AgentChatModelDefinition,
  profile: AgentTaskProfile,
  phase: AgentStepPhase,
  maxOutputTokens?: number,
): AgentProviderOptions | undefined {
  if (!model.capabilities.reasoning) return undefined;
  const effort = effortFor(profile, phase);
  const budgetTokens = reasoningBudgetTokens(effort, maxOutputTokens);
  switch (model.adapter) {
    case "openai-responses":
    case "opencode-openai-responses":
      return { openai: { reasoningEffort: effort } };
    case "anthropic-messages":
    case "opencode-anthropic-messages":
      // Anthropic extended thinking has a 1,024-token minimum. If the
      // response ceiling cannot leave that much room, omit hidden thinking
      // for this step rather than sending an invalid/oversized budget.
      if (budgetTokens < 1_024) return undefined;
      return {
        anthropic: {
          thinking: { type: "enabled", budgetTokens },
        },
      };
    case "google-generative-ai":
    case "opencode-google":
      return {
        google: {
          thinkingConfig: { thinkingBudget: budgetTokens },
        },
      };
    default:
      return undefined;
  }
}
