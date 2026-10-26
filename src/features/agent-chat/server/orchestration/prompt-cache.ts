import type { ModelMessage, SystemModelMessage } from "ai";
import type { AgentChatModelDefinition } from "../../shared/model-registry-types";
import type { AgentStepInstructionRegions } from "../prompts";

export type AgentProviderOptions = NonNullable<SystemModelMessage["providerOptions"]>;

function mergeProviderRecords(
  left: AgentProviderOptions | undefined,
  right: AgentProviderOptions | undefined,
): AgentProviderOptions | undefined {
  if (!left) return right;
  if (!right) return left;
  const merged: AgentProviderOptions = { ...left };
  for (const [provider, options] of Object.entries(right)) {
    merged[provider] = { ...(merged[provider] ?? {}), ...options };
  }
  return merged;
}

export function mergeModelProviderOptions(
  ...values: Array<AgentProviderOptions | undefined>
): AgentProviderOptions | undefined {
  return values.reduce<AgentProviderOptions | undefined>(
    (current, next) => mergeProviderRecords(current, next),
    undefined,
  );
}


function isAnthropicAdapter(model: AgentChatModelDefinition): boolean {
  return model.adapter === "anthropic-messages"
    || model.adapter === "opencode-anthropic-messages";
}

function cacheableAnthropicSystemMessage(content: string): SystemModelMessage {
  return {
    role: "system",
    content,
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  };
}

/**
 * Preserve independent Anthropic cache boundaries for the stable agent prefix
 * and request-stable context. A single concatenated system string would make a
 * phase/MCP suffix change invalidate the whole system block before the message
 * cache breakpoint. Providers with token-prefix caching can use the same text
 * ordering without extra system-message boundaries.
 */
export function buildCacheAwareSystemInstructions(
  model: AgentChatModelDefinition,
  regions: AgentStepInstructionRegions,
): string | SystemModelMessage[] {
  const ordered = [regions.stable, regions.request, regions.mcp, regions.volatile]
    .filter(Boolean);
  if (!isAnthropicAdapter(model)) return ordered.join("\n\n");

  const messages: SystemModelMessage[] = [];
  if (regions.stable) messages.push(cacheableAnthropicSystemMessage(regions.stable));
  if (regions.request) messages.push(cacheableAnthropicSystemMessage(regions.request));
  // Active MCP guidance normally remains stable for the same materialized
  // schema set. Giving it its own breakpoint uses Anthropic's remaining system
  // cache slot without coupling the much larger stable/request regions to MCP
  // churn; the newest conversation message remains the fourth incremental
  // breakpoint applied below.
  if (regions.mcp) messages.push(cacheableAnthropicSystemMessage(regions.mcp));
  if (regions.volatile) messages.push({ role: "system", content: regions.volatile });
  return messages;
}

/**
 * Anthropic requires an explicit cache breakpoint. Marking the newest projected
 * message gives the provider an incrementally growing cached prefix while the
 * canonical conversation remains provider-neutral. OpenAI/Gemini benefit from
 * the stable prefix automatically and are left structurally unchanged here.
 */
export function applyIncrementalPromptCaching(
  model: AgentChatModelDefinition,
  messages: readonly ModelMessage[],
): ModelMessage[] {
  if (!isAnthropicAdapter(model)) {
    return [...messages];
  }
  const lastIndex = messages.length - 1;
  if (lastIndex < 0) return [];
  return messages.map((message, index) => {
    if (index !== lastIndex) return message;
    const existing = (
      "providerOptions" in message
      && message.providerOptions
      && typeof message.providerOptions === "object"
    )
      ? message.providerOptions
      : undefined;
    return {
      ...message,
      providerOptions: mergeModelProviderOptions(existing, {
        anthropic: { cacheControl: { type: "ephemeral" } },
      }),
    } as ModelMessage;
  });
}

export function buildPromptCacheProviderOptions(
  model: AgentChatModelDefinition,
  namespace: string,
): AgentProviderOptions | undefined {
  if (
    model.adapter !== "openai-responses"
    && model.adapter !== "opencode-openai-responses"
  ) {
    return undefined;
  }
  // Cache affinity should follow the physical provider/model identity rather
  // than an AgentRanking registry alias. Two model keys that resolve to the
  // same provider model can then share the provider's routing/cache hint,
  // while provider/adapter boundaries remain isolated.
  const provider = model.credentialProvider ?? model.provider;
  const cacheKey = [
    namespace,
    provider,
    model.adapter,
    model.providerModelId,
  ].join(":").slice(0, 256);
  return { openai: { promptCacheKey: cacheKey } };
}
