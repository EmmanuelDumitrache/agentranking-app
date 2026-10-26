import {
  getOrbitMcpReadiness,
  type McpReadiness,
  type OrbitMcpReadinessInput,
} from "@/lib/orbit/orbit-mcp-readiness";

export type AgentInstallInfo = {
  readonly readiness: McpReadiness;
  readonly endpoint: string | null;
  readonly serverKey: string;
  readonly cursorJson: string;
  readonly claudeCommand: string;
};

function slugifyServerKey(chainShortName: string, agentId: number): string {
  const chain = chainShortName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const safeChain = chain || "chain";
  return `${safeChain}-${agentId}`;
}

export function buildAgentInstallInfo(
  chainShortName: string,
  agentId: number,
  input: OrbitMcpReadinessInput,
): AgentInstallInfo {
  const readiness = getOrbitMcpReadiness(input);
  const serverKey = slugifyServerKey(chainShortName, agentId);
  const endpoint = readiness.endpoint;
  const cursorJson =
    endpoint == null
      ? ""
      : JSON.stringify(
          {
            mcpServers: {
              [serverKey]: { url: endpoint },
            },
          },
          null,
          2,
        );
  const claudeCommand =
    endpoint == null ? "" : `claude mcp add --transport http ${serverKey} ${endpoint}`;

  return {
    readiness: readiness.readiness,
    endpoint,
    serverKey,
    cursorJson,
    claudeCommand,
  };
}
