import type { AgentPassport } from "@/lib/agent-launch/passport";
export type DemoLaunchTemplate = {
  id: string;
  label: string;
  /** Stored on the draft as agentId for demo launches (not a persisted Agent record). */
  demoAgentId: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDescription: string;
  tokenImageUrl: string;
  passportOverrides: {
    agentName: string;
    capabilities: AgentPassport["capabilities"];
    analytics: Pick<AgentPassport["analytics"], "apiCallsTracked">;
  };
};
const DEMO_IMAGE_BASE = "https://agentranking.io/brand/demo";
export const AGENT_LAUNCH_DEMO_TEMPLATES: DemoLaunchTemplate[] = [
  {
    id: "ar-api-agent",
    label: "AR API Agent",
    demoAgentId: "demo:ar-api-agent",
    tokenName: "AR API Agent",
    tokenSymbol: "ARAPI",
    tokenDescription:
      "Devnet demo agent for paid REST API routing, x402 micropayments, and AgentRanking discovery. Exposes a mock HTTP endpoint for local smoke testing.",
    tokenImageUrl: `${DEMO_IMAGE_BASE}/ar-api-agent.png`,
    passportOverrides: {
      agentName: "AR API Agent",
      capabilities: {
        api: { ready: true, endpoint: "https://api.example.local/ar-api-agent" },
        x402: { ready: true, endpoint: "https://api.example.local/ar-api-agent/x402" },
        mcp: { ready: false, endpoint: null },
        github: { ready: true, repo: "agentranking/demo-ar-api-agent" },
      },
      analytics: { apiCallsTracked: true },
    },
  },
  {
    id: "ar-mcp-agent",
    label: "AR MCP Agent",
    demoAgentId: "demo:ar-mcp-agent",
    tokenName: "AR MCP Agent",
    tokenSymbol: "ARMCP",
    tokenDescription:
      "Devnet demo agent for MCP capability indexing through AgentRanking.",
    tokenImageUrl: `${DEMO_IMAGE_BASE}/ar-mcp-agent.png`,
    passportOverrides: {
      agentName: "AR MCP Agent",
      capabilities: {
        mcp: { ready: true, endpoint: "mcp://local/ar-mcp-agent" },
        x402: { ready: false, endpoint: null },
        api: { ready: false, endpoint: null },
        github: { ready: true, repo: "agentranking/demo-ar-mcp-agent" },
      },
      analytics: { apiCallsTracked: false },
    },
  },
  {
    id: "ar-data-agent",
    label: "AR Data Agent",
    demoAgentId: "demo:ar-data-agent",
    tokenName: "AR Data Agent",
    tokenSymbol: "ARDATA",
    tokenDescription:
      "Devnet demo agent for analytics and data-service discovery through AgentRanking.",
    tokenImageUrl: `${DEMO_IMAGE_BASE}/ar-data-agent.png`,
    passportOverrides: {
      agentName: "AR Data Agent",
      capabilities: {
        api: { ready: true, endpoint: "https://data.example.local/ar-data-agent/query" },
        x402: { ready: true, endpoint: "https://data.example.local/ar-data-agent/x402" },
        mcp: { ready: false, endpoint: null },
        github: { ready: true, repo: "agentranking/demo-ar-data-agent" },
      },
      analytics: { apiCallsTracked: true },
    },
  },
];
/** Minimal launch fields used to resolve a demo preset. */
export type DemoLaunchLookup = {
  agentId?: string | null;
  tokenSymbol?: string | null;
  tokenName?: string | null;
};
export function findDemoLaunchTemplateByAgentId(agentId: string | null | undefined): DemoLaunchTemplate | null {
  if (!agentId?.startsWith("demo:")) return null;
  return (
    AGENT_LAUNCH_DEMO_TEMPLATES.find((template) => template.demoAgentId === agentId) ?? null
  );
}
export function findDemoLaunchTemplateByTokenSymbol(
  tokenSymbol: string | null | undefined,
): DemoLaunchTemplate | null {
  const symbol = tokenSymbol?.trim().toUpperCase();
  if (!symbol) return null;
  return AGENT_LAUNCH_DEMO_TEMPLATES.find((template) => template.tokenSymbol === symbol) ?? null;
}
/** Resolve demo preset from stored agentId or known demo token symbol. */
export function findDemoLaunchTemplateForLaunch(launch: DemoLaunchLookup): DemoLaunchTemplate | null {
  return (
    findDemoLaunchTemplateByAgentId(launch.agentId) ??
    findDemoLaunchTemplateByTokenSymbol(launch.tokenSymbol)
  );
}
/** Passport overrides for a launch row, derived from its demo preset when applicable. */
export function demoPassportOverridesForLaunch(
  launch: DemoLaunchLookup,
): DemoLaunchTemplate["passportOverrides"] | undefined {
  return findDemoLaunchTemplateForLaunch(launch)?.passportOverrides;
}
/** Merge demo preset overrides with optional client overrides (client wins on conflicts). */
export function mergeDemoPassportOverrides(
  launch: DemoLaunchLookup,
  clientOverrides?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const demo = demoPassportOverridesForLaunch(launch);
  if (!demo && !clientOverrides) return undefined;
  const demoRecord = demo as Record<string, unknown> | undefined;
  if (!clientOverrides) {
    return demoRecord ? { ...demoRecord } : undefined;
  }
  if (!demoRecord) {
    return { ...clientOverrides };
  }
  const demoCaps =
    typeof demoRecord.capabilities === "object" && demoRecord.capabilities
      ? (demoRecord.capabilities as Record<string, unknown>)
      : {};
  const clientCaps =
    typeof clientOverrides.capabilities === "object" && clientOverrides.capabilities
      ? (clientOverrides.capabilities as Record<string, unknown>)
      : {};
  return {
    ...demoRecord,
    ...clientOverrides,
    capabilities: {
      ...demoCaps,
      ...clientCaps,
      mcp: { ...(demoCaps.mcp as object), ...(clientCaps.mcp as object) },
      x402: { ...(demoCaps.x402 as object), ...(clientCaps.x402 as object) },
      api: { ...(demoCaps.api as object), ...(clientCaps.api as object) },
      github: { ...(demoCaps.github as object), ...(clientCaps.github as object) },
    },
    analytics: {
      ...(typeof demoRecord.analytics === "object" ? demoRecord.analytics : {}),
      ...(typeof clientOverrides.analytics === "object" ? clientOverrides.analytics : {}),
    },
  };
}
