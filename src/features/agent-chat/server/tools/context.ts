import type { ToolSet } from "ai";
import { z } from "zod/v4";
import { copyToolEffect } from "./tool-effects";

export const agentToolContextSchema = z.object({
  agentDbId: z.number().int().positive(),
  appAccountId: z.string().min(1),
  userProfileId: z.number().int().positive(),
  runId: z.string().min(1),
  /** Whether this run already uses the same platform provider as the embedding lane. */
  allowPlatformSemanticRanking: z.boolean(),
});

export type AgentToolContext = z.infer<typeof agentToolContextSchema>;

/** Validate the authenticated execution context shared by AgentRanking-owned tools. */
export function buildAgentChatToolContext(
  context: AgentToolContext,
): AgentToolContext {
  return agentToolContextSchema.parse(context);
}

type RuntimeTool = {
  contextSchema?: unknown;
  execute?: (input: unknown, options: unknown) => unknown;
};

function bindExecutionOptions(
  options: unknown,
  context: AgentToolContext,
): { context: AgentToolContext } & Record<string, unknown> {
  return options && typeof options === "object" && !Array.isArray(options)
    ? { ...(options as Record<string, unknown>), context }
    : { context };
}

/**
 * Bind authenticated AgentRanking execution context at the dynamic tool-set
 * boundary. AI SDK 7 infers `toolsContext` from statically known tool keys;
 * this application intentionally combines runtime MCP/provider/SAK tools into
 * a dynamic ToolSet, which erases that type information. Binding only tools
 * that carry the exact AgentRanking context schema keeps the same isolation
 * guarantee without widening context to third-party tools or relying on an
 * unsafe SDK-level cast.
 */
export function bindAgentChatToolContext(
  tools: ToolSet,
  context: AgentToolContext,
): ToolSet {
  const validated = buildAgentChatToolContext(context);
  const bound: ToolSet = {};

  for (const [name, candidate] of Object.entries(tools)) {
    const runtimeTool = candidate as unknown as RuntimeTool;
    if (runtimeTool.contextSchema !== agentToolContextSchema) {
      bound[name] = candidate;
      continue;
    }

    const execute = runtimeTool.execute;
    const clone = {
      ...(candidate as unknown as Record<string, unknown>),
    } as RuntimeTool & Record<string, unknown>;
    delete clone.contextSchema;
    if (execute) {
      clone.execute = (input: unknown, options: unknown) =>
        execute(input, bindExecutionOptions(options, validated));
    }

    const sdkTool = clone as unknown as ToolSet[string];
    copyToolEffect(candidate, sdkTool);
    bound[name] = sdkTool;
  }

  return bound;
}

/** Fail closed when a tool is invoked without the authenticated run context. */
export function requireAgentToolContext(value: unknown): AgentToolContext {
  const parsed = agentToolContextSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Agent tool execution context is missing or invalid");
  }
  return parsed.data;
}
