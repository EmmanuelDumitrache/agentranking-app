export type ToolChoiceSupportModel = {
  provider: string;
  adapter: string;
  providerModelId: string;
};
/**
 * DeepSeek V4 thinking models reject the OpenAI `tool_choice` parameter and
 * require assistant tool-call messages to carry non-null content.
 */
export function isDeepSeekV4ModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return /(?:^|\/)deepseek-v4(?:[-.]|$)/.test(normalized);
}
export function supportsExplicitToolChoice(
  model: ToolChoiceSupportModel,
): boolean {
  return !(
    model.provider === "opencode" &&
    model.adapter === "opencode-openai-compatible" &&
    isDeepSeekV4ModelId(model.providerModelId)
  );
}
/**
 * Normalize OpenCode's OpenAI-compatible request body for DeepSeek V4.
 *
 * The AI SDK OpenAI-compatible adapter correctly preserves reasoning parts as
 * `reasoning_content`. This transform handles the two remaining DeepSeek V4
 * incompatibilities: omit `tool_choice` and keep assistant tool-call content
 * non-null for the next round.
 */
export function normalizeOpenCodeRequestBody(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const modelId = typeof args.model === "string" ? args.model : "";
  if (!isDeepSeekV4ModelId(modelId)) return args;
  const { tool_choice: _toolChoice, ...rest } = args;
  const messages = Array.isArray(rest.messages)
    ? rest.messages.map(normalizeDeepSeekAssistantToolCallMessage)
    : rest.messages;
  return {
    ...rest,
    ...(messages !== undefined ? { messages } : {}),
  };
}
function normalizeDeepSeekAssistantToolCallMessage(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const message = value as Record<string, unknown>;
  if (
    message.role !== "assistant" ||
    !Array.isArray(message.tool_calls) ||
    message.tool_calls.length === 0 ||
    message.content !== null
  ) {
    return value;
  }
  return { ...message, content: "" };
}
