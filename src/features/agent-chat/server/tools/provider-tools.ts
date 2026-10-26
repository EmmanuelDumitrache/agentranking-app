import "server-only";

import type { ToolSet } from "ai";

export type AgentRuntimeToolMetadata = {
  source: "local" | "mcp" | "provider";
  providerId?: string;
  capability?: "web_search";
};

const metadata = new WeakMap<object, AgentRuntimeToolMetadata>();

export function markAgentRuntimeToolMetadata(
  tool: object,
  value: AgentRuntimeToolMetadata,
): void {
  metadata.set(tool, value);
}

export function getAgentRuntimeToolMetadata(
  tool: unknown,
): AgentRuntimeToolMetadata | undefined {
  return typeof tool === "object" && tool !== null
    ? metadata.get(tool)
    : undefined;
}

export function composeAgentTools(params: {
  localTools: ToolSet;
  providerTools: ToolSet;
  providerId: string;
}): ToolSet {
  const composed: ToolSet = { ...params.localTools };
  for (const [name, tool] of Object.entries(params.providerTools)) {
    let effectiveName = name;
    if (effectiveName in composed) {
      effectiveName = `${params.providerId}_${name}`;
      if (effectiveName in composed) {
        throw new Error(
          `Cannot compose provider tool "${name}": both "${name}" and "${effectiveName}" already exist`,
        );
      }
    }
    if (typeof tool === "object" && tool !== null) {
      markAgentRuntimeToolMetadata(tool, {
        source: "provider",
        providerId: params.providerId,
        ...(name === "web_search" ? { capability: "web_search" as const } : {}),
      });
    }
    composed[effectiveName] = tool;
  }
  return composed;
}

export function isWebSearchRuntimeTool(toolName: string, tools: ToolSet): boolean {
  return getAgentRuntimeToolMetadata(tools[toolName])?.capability === "web_search";
}
