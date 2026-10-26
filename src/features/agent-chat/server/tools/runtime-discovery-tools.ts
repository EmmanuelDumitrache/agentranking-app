import "server-only";

import { tool, type ToolSet } from "ai";
import { z } from "zod/v4";
import type { ToolSelectionEntry } from "../orchestration/types";
import { profileAgentTask } from "../orchestration/task-profile";
import { rankToolCatalogSemantically } from "../orchestration/tool-selection";
import { inspectRuntimeToolCatalog } from "./runtime-tool-discovery-core";
import { markAgentRuntimeToolMetadata } from "./provider-tools";
import { markToolEffect } from "./tool-effects";
import { agentToolContextSchema, requireAgentToolContext } from "./context";

function markDiscoveryTool<T extends ToolSet[string]>(value: T): T {
  if (typeof value === "object" && value !== null) {
    markAgentRuntimeToolMetadata(value, { source: "local" });
  }
  return markToolEffect(value, { stateChanging: false });
}

export function buildRuntimeDiscoveryTools(
  catalog: readonly ToolSelectionEntry[],
): ToolSet {
  const runtime_tool_search = markDiscoveryTool(tool({
    description:
      "Search the runtime capability catalog when the needed concrete tool is not currently exposed. Results include exact runtime names that can be materialized on the next agent step.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    contextSchema: agentToolContextSchema,
    execute: async (input, { context: executionContext }) => {
      const context = requireAgentToolContext(executionContext);
      const profile = profileAgentTask({ text: input.query });
      const semanticScores = await rankToolCatalogSemantically({
        profile,
        userText: input.query,
        catalog,
        availableToolNames: catalog.map((entry) => entry.name),
        allowPlatformSemanticRanking: context.allowPlatformSemanticRanking,
      });
      return inspectRuntimeToolCatalog(catalog, {
        query: input.query,
        limit: input.limit ?? 8,
        includeDescriptions: true,
      }, {
        includeRuntimeNames: true,
        semanticScores,
      });
    },
  }));


  return { runtime_tool_search };
}
