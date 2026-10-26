import "server-only";

import { tool, type ToolSet } from "ai";
import { z } from "zod/v4";
import { markAgentRuntimeToolMetadata } from "./provider-tools";
import { markToolEffect } from "./tool-effects";

export type IsolatedSubagentInput = {
  objective: string;
  artifactIds: string[];
  historyQuery?: string;
  maxOutputTokens?: number;
};

export function buildIsolatedSubagentTools(params: {
  delegate(input: IsolatedSubagentInput): Promise<unknown>;
}): ToolSet {
  let used = false;
  const delegate_context_analysis = tool({
    description:
      "Delegate one verbose read-only evidence analysis to an isolated cheap-model context. Use after large tool results were externalized or when a high-complexity task needs synthesis without carrying bulky evidence in the parent context. The delegate cannot perform state-changing actions. Returns a concise synthesis plus evidence references.",
    inputSchema: z.object({
      objective: z.string().min(1).max(2_000),
      artifactIds: z.array(z.string().min(1)).max(8).default([]),
      historyQuery: z.string().min(1).max(1_000).optional(),
      maxOutputTokens: z.number().int().min(300).max(2_000).optional(),
    }),
    execute: async (input) => {
      if (used) {
        return {
          ok: false,
          status: "delegate_limit_reached",
          message: "Only one isolated delegate is available per parent run.",
        };
      }
      used = true;
      return params.delegate({
        objective: input.objective,
        artifactIds: input.artifactIds,
        historyQuery: input.historyQuery,
        maxOutputTokens: input.maxOutputTokens,
      });
    },
  });
  markAgentRuntimeToolMetadata(delegate_context_analysis as object, { source: "local" });
  markToolEffect(delegate_context_analysis, { stateChanging: false });
  return { delegate_context_analysis };
}
