import { PUBLIC_MCP_DEFAULT_SEARCH, PUBLIC_MCP_MAX_SEARCH, PUBLIC_MCP_MAX_TRUST_WALLETS } from "@/lib/public-mcp/config";

export type PublicMcpJsonSchema = {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
};

export type PublicMcpToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: PublicMcpJsonSchema;
};

const chainAgentIds = {
  chainId: { type: "integer", description: "AgentRanking chain id (e.g. Solana app chain)" },
  agentId: { type: "integer", description: "On-chain / directory agent id on that chain" },
} as const;

export const PUBLIC_MCP_TOOLS = [
  {
    name: "search_agents",
    description:
      "Search the AgentRanking public index by name, description, owner, chain, archetype, verification, or skills. Returns ranked public profiles.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Name, description, or owner substring" },
        chainId: { type: "integer", description: "Filter to a chain id" },
        archetype: { type: "string", description: "Archetype slug such as trading, sniper, mev" },
        verified: { type: "boolean", description: "When true, only verified or premium-verified agents" },
        skills: {
          type: "string",
          description: "Comma-separated capability tags: mcp, a2a, oasf",
        },
        sort: {
          type: "string",
          description:
            "agent_rank_desc (default), profile_desc, protocol_trust_desc, execution_desc, activity_desc, created_desc",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: PUBLIC_MCP_MAX_SEARCH,
          description: `How many agents to return (default ${PUBLIC_MCP_DEFAULT_SEARCH}, max ${PUBLIC_MCP_MAX_SEARCH})`,
        },
      },
    },
  },
  {
    name: "get_agent",
    description: "Fetch a public AgentRanking profile by chainId and agentId.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["chainId", "agentId"],
      properties: chainAgentIds,
    },
  },
  {
    name: "get_top_agents",
    description: "Top agents by Agent Rank. Optional chain and archetype filters.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        chainId: { type: "integer" },
        archetype: { type: "string" },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: PUBLIC_MCP_MAX_SEARCH,
          description: `Default ${PUBLIC_MCP_DEFAULT_SEARCH}, max ${PUBLIC_MCP_MAX_SEARCH}`,
        },
      },
    },
  },
  {
    name: "get_trust_scores",
    description: "Bulk Trust Oracle payloads for up to 20 wallets. Unregistered wallets still return a payload.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["wallets"],
      properties: {
        wallets: {
          type: "array",
          maxItems: PUBLIC_MCP_MAX_TRUST_WALLETS,
          items: { type: "string" },
          description: "EVM 0x… or Solana base58 wallets",
        },
      },
    },
  },
  {
    name: "get_agent_reputation",
    description:
      "Trust Oracle for one wallet: registration, verification tier, trust score, reports, and a caution/proceed recommendation. No PII.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["wallet"],
      properties: {
        wallet: { type: "string", description: "EVM or Solana wallet" },
      },
    },
  },
  {
    name: "get_verified_status",
    description:
      "Public verification flags for an agent plus the operator credential when KYC is currently valid (AR-… public id). No PII.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["chainId", "agentId"],
      properties: chainAgentIds,
    },
  },
  {
    name: "get_agent_credential",
    description:
      "Public operator credential for an agent. Present only when KYC is currently valid. Returns AR-… id and proof path. No PII.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["chainId", "agentId"],
      properties: chainAgentIds,
    },
  },
  {
    name: "get_agent_risk",
    description: "Public Agent Risk Oracle by owner wallet. Risk tier, score, factor summary, card eligibility. No PII.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["wallet"],
      properties: {
        wallet: { type: "string" },
      },
    },
  },
  {
    name: "get_agent_passport",
    description: "Agent Passport by AgentRanking database id (Agent.id). No PII.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["agent_id"],
      properties: {
        agent_id: { type: "integer", description: "Agent database primary key" },
      },
    },
  },
  {
    name: "check_card_eligibility",
    description: "Card spend eligibility for a wallet via the configured issuer adapter.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["wallet"],
      properties: {
        wallet: { type: "string" },
      },
    },
  },
  {
    name: "get_fairscale_assessment",
    description:
      "Cached FairScale trust assessment for an agent (score / 100, tier, pillars) when FairScale is enabled. Read-only; does not request a new scan.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["chainId", "agentId"],
      properties: chainAgentIds,
    },
  },
] as const satisfies readonly PublicMcpToolDefinition[];

export type PublicMcpToolName = (typeof PUBLIC_MCP_TOOLS)[number]["name"];

export const PUBLIC_MCP_TOOL_NAMES: readonly PublicMcpToolName[] = PUBLIC_MCP_TOOLS.map(
  (tool) => tool.name,
);

export function isPublicMcpToolName(value: string): value is PublicMcpToolName {
  return (PUBLIC_MCP_TOOL_NAMES as readonly string[]).includes(value);
}

export function publicMcpToolsListPayload() {
  return PUBLIC_MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
