import "server-only";

import {
  AGENT_LIST_SELECT,
  agentsListOrderBy,
  buildActiveAgentsWhere,
  formatAgentRow,
  queryAgentsListShared,
} from "@/lib/agents-api-shared";
import { extendAgentWhereNotBlocked } from "@/lib/agent-blocklist";
import { prisma } from "@/lib/db";
import { fairscaleEnabled } from "@/lib/fairscale/config";
import { getFairscaleAssessmentForAgent } from "@/lib/fairscale/assess.server";
import { emptyFairscalePublicAssessment } from "@/lib/fairscale/serialize";
import {
  PUBLIC_MCP_DEFAULT_SEARCH,
  PUBLIC_MCP_MAX_SEARCH,
  PUBLIC_MCP_MAX_TRUST_WALLETS,
} from "@/lib/public-mcp/config";
import type { PublicMcpToolName } from "@/lib/public-mcp/catalog";
import { buildTrustOraclePayload, InvalidWalletError } from "@/lib/trust-oracle";
import { loadAgentPublicCredential } from "@/lib/verification/public-agent-credential.server";
import { withCredentialProofUrl } from "@/lib/verification/public-agent-credential";
import {
  checkCardEligibilityOracle,
  getAgentPassportOracle,
  getAgentRiskOracle,
} from "@/lib/verification/oracle-tools";
import { getPublicSiteUrl } from "@/lib/site-url";

type FormattedAgent = ReturnType<typeof formatAgentRow>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
function readBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
function readInt(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}
function requireInt(args: Record<string, unknown>, key: string): number {
  const value = readInt(args, key);
  if (value === undefined) throw new Error(`${key} is required`);
  return value;
}
function clampLimit(args: Record<string, unknown>): number {
  const raw = readInt(args, "limit") ?? PUBLIC_MCP_DEFAULT_SEARCH;
  return Math.min(PUBLIC_MCP_MAX_SEARCH, Math.max(1, raw));
}
function truncateDescription(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  if (text.length <= 400) return text;
  return `${text.slice(0, 397).trimEnd()}…`;
}
function mcpAgentSummary(agent: FormattedAgent) {
  return {
    agentId: agent.agentId,
    chainId: agent.chainId,
    name: agent.name,
    slug: agent.slug,
    profilePath: agent.profilePath,
    profileUrl: agent.profileUrl,
    description: truncateDescription(agent.description),
    owner: agent.owner,
    score: agent.score,
    agentRankScore: agent.agentRankScore,
    protocolTrustScore: agent.protocolTrustScore,
    executionScore: agent.executionScore,
    isVerified: agent.isVerified,
    isPremiumVerified: agent.isPremiumVerified,
    archetype: agent.archetype,
    chain: agent.chain,
    x402Support: agent.x402Support,
    lastActiveAt: agent.lastActiveAt,
    capabilities: agent.capabilities,
  };
}
async function searchAgents(args: Record<string, unknown>, sortOverride?: string) {
  const limit = clampLimit(args);
  const verified = readBoolean(args, "verified");
  const chainId = readInt(args, "chainId");
  const filter = buildActiveAgentsWhere({
    search: readString(args, "query") ?? "",
    chain: chainId != null ? String(chainId) : undefined,
    archetype: readString(args, "archetype") ?? null,
    verified: verified === true ? "true" : null,
    skillsParam: readString(args, "skills") ?? "",
  });
  const sort = sortOverride ?? readString(args, "sort") ?? "agent_rank_desc";
  const { rows, total } = await queryAgentsListShared({
    where: filter,
    orderBy: agentsListOrderBy(sort),
    skip: 0,
    take: limit,
  });
  return {
    total,
    returned: rows.length,
    agents: rows.map((row) => mcpAgentSummary(formatAgentRow(row))),
  };
}
async function getAgent(args: Record<string, unknown>) {
  const chainId = requireInt(args, "chainId");
  const agentId = requireInt(args, "agentId");
  const where = await extendAgentWhereNotBlocked({ chainId, agentId, isActive: true });
  const row = await prisma.agent.findFirst({
    where,
    select: AGENT_LIST_SELECT,
  });
  if (!row) return { found: false, agent: null };
  return { found: true, agent: mcpAgentSummary(formatAgentRow(row)) };
}
async function getTrustScores(args: Record<string, unknown>) {
  const walletsRaw = args.wallets;
  if (!Array.isArray(walletsRaw)) throw new Error("wallets must be an array of strings");
  const wallets = walletsRaw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, PUBLIC_MCP_MAX_TRUST_WALLETS);
  const scores = [];
  for (const wallet of wallets) {
    try {
      scores.push(await buildTrustOraclePayload(wallet));
    } catch (error) {
      if (error instanceof InvalidWalletError) {
        scores.push({ wallet, error: "invalid_wallet" });
        continue;
      }
      throw error;
    }
  }
  return { count: scores.length, scores };
}
async function getVerifiedStatus(args: Record<string, unknown>) {
  const chainId = requireInt(args, "chainId");
  const agentId = requireInt(args, "agentId");
  const where = await extendAgentWhereNotBlocked({ chainId, agentId, isActive: true });
  const row = await prisma.agent.findFirst({
    where,
    select: {
      name: true,
      isVerified: true,
      isPremiumVerified: true,
      publicVerificationStatus: true,
      arVerificationStatus: true,
    },
  });
  if (!row) return { found: false };
  const credential = await loadAgentPublicCredential(chainId, agentId);
  return {
    found: true,
    chainId,
    agentId,
    name: row.name,
    isVerified: row.isVerified,
    isPremiumVerified: row.isPremiumVerified,
    publicVerificationStatus: row.publicVerificationStatus,
    arVerificationStatus: row.arVerificationStatus,
    credential: credential ? withCredentialProofUrl(credential, getPublicSiteUrl()) : { present: false },
  };
}
async function getFairscale(args: Record<string, unknown>) {
  const chainId = requireInt(args, "chainId");
  const agentId = requireInt(args, "agentId");
  if (!fairscaleEnabled()) {
    return { found: true, assessment: emptyFairscalePublicAssessment("temporarily_unavailable") };
  }
  const where = await extendAgentWhereNotBlocked({ chainId, agentId, isActive: true });
  const row = await prisma.agent.findFirst({
    where,
    select: { id: true },
  });
  if (!row) return { found: false, assessment: null };
  const assessment = await getFairscaleAssessmentForAgent(row.id, { queueRefresh: false });
  return { found: true, assessment };
}
export async function executePublicMcpTool(
  name: PublicMcpToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  const input = isRecord(args) ? args : {};
  switch (name) {
    case "search_agents":
      return searchAgents(input);
    case "get_agent":
      return getAgent(input);
    case "get_top_agents":
      return searchAgents(input, "agent_rank_desc");
    case "get_trust_scores":
      return getTrustScores(input);
    case "get_agent_reputation": {
      const wallet = readString(input, "wallet");
      if (!wallet) throw new Error("wallet is required");
      return buildTrustOraclePayload(wallet);
    }
    case "get_verified_status":
      return getVerifiedStatus(input);
    case "get_agent_credential": {
      const chainId = requireInt(input, "chainId");
      const agentId = requireInt(input, "agentId");
      const credential = await loadAgentPublicCredential(chainId, agentId);
      if (!credential) return { found: false, credential: { present: false } };
      return {
        found: true,
        credential: withCredentialProofUrl(credential, getPublicSiteUrl()),
      };
    }
    case "get_agent_risk": {
      const wallet = readString(input, "wallet");
      if (!wallet) throw new Error("wallet is required");
      return getAgentRiskOracle(wallet);
    }
    case "get_agent_passport":
      return getAgentPassportOracle(requireInt(input, "agent_id"));
    case "check_card_eligibility": {
      const wallet = readString(input, "wallet");
      if (!wallet) throw new Error("wallet is required");
      return checkCardEligibilityOracle(wallet);
    }
    case "get_fairscale_assessment":
      return getFairscale(input);
    default: {
      const exhaustive: never = name;
      throw new Error(`Unhandled public MCP tool: ${String(exhaustive)}`);
    }
  }
}
