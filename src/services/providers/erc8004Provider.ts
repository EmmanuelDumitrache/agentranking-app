import "server-only";
import { createPublicClient, defineChain, http, parseAbiItem } from "viem";
import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { getChainByChainId } from "@/lib/chains";
import { RPC_URLS } from "@/lib/erc8004-sync";
import { fetchOnChainOwnerAndWallet } from "@/lib/on-chain-agent";
import { fetchAgentRegistrationJson } from "@/lib/fetch-agent-registration";
import { fetchValidationHistory } from "@/lib/validation-registry-history";
import {
  aggregateReputationScore,
  feedbackSourceFromIndex,
  normalizeFeedbackValue,
} from "@/lib/reputation/feedback-decode";
import {
  evmExplorerTokenUrl,
  extractRegistrationsFromAgentUri,
  parseRegistrationMetadata,
  type RegistrationMetaEntry,
} from "@/lib/agent-identity";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import type {
  AgentCard,
  AgentHandle,
  ChainFetchError,
  ChainIdentityDeployment,
  ChainReputationFootprint,
  ChainValidationFootprint,
} from "@/types/agent";
const REPUTATION_ABI = [
  {
    name: "getClients",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
  {
    name: "readAllFeedback",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "includeRevoked", type: "bool" },
    ],
    outputs: [
      { name: "clients", type: "address[]" },
      { name: "feedbackIndexes", type: "uint64[]" },
      { name: "values", type: "int128[]" },
      { name: "valueDecimals", type: "uint8[]" },
      { name: "tag1s", type: "string[]" },
      { name: "tag2s", type: "string[]" },
      { name: "revokedStatuses", type: "bool[]" },
    ],
  },
] as const;
const TOKEN_URI_ABI = [parseAbiItem("function tokenURI(uint256 tokenId) view returns (string)")] as const;
export type Erc8004ProviderContext = {
  hydrateValidation?: boolean;
  maxValidationRecordsPerChain?: number;
};
export interface Erc8004Provider {
  getIdentity(
    handle: AgentHandle,
    ctx?: Erc8004ProviderContext,
  ): Promise<{ deployment: ChainIdentityDeployment; error?: ChainFetchError }>;
  getReputation(handle: AgentHandle): Promise<{ footprint: ChainReputationFootprint; error?: ChainFetchError }>;
  getValidation(
    handle: AgentHandle,
    ctx?: Erc8004ProviderContext,
  ): Promise<{ footprint: ChainValidationFootprint; error?: ChainFetchError }>;
}
function buildRpcClient(chainId: number) {
  const rpcUrl = RPC_URLS[chainId]?.trim();
  if (!rpcUrl) return null;
  const chain = defineChain({
    id: chainId,
    name: String(chainId),
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(rpcUrl, { timeout: 45_000 }) });
}
function registrationRefsFromSources(
  agentURI: string,
  metadataRegistrations: string | null | undefined,
): RegistrationMetaEntry[] {
  const out: RegistrationMetaEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: RegistrationMetaEntry) => {
    const chainId = entry.chainId ?? 0;
    const agentId = entry.agentId ?? 0;
    if (!chainId || !agentId) return;
    const key = `${chainId}:${agentId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };
  if (metadataRegistrations) {
    for (const entry of parseRegistrationMetadata(metadataRegistrations)) add(entry);
  }
  for (const entry of extractRegistrationsFromAgentUri(agentURI)) add(entry);
  return out;
}
function agentCardFromRegistration(reg: Awaited<ReturnType<typeof fetchAgentRegistrationJson>>): AgentCard | null {
  if (!reg) return null;
  const services = [...(reg.services ?? []), ...(reg.endpoints ?? [])];
  const mcpEndpoints = services
    .filter((s) => (s.name ?? "").toLowerCase().includes("mcp"))
    .map((s) => s.endpoint)
    .filter((endpoint): endpoint is string => Boolean(endpoint));
  const capabilities = [
    ...(reg.mcpTools ?? []),
    ...(Array.isArray(reg.customTags) ? reg.customTags : reg.customTags ? [reg.customTags] : []),
  ];
  const paymentTokens = reg.tokenAddress ? [reg.tokenAddress] : [];
  return {
    name: reg.name,
    description: reg.description,
    image: reg.image,
    capabilities,
    mcpEndpoints,
    paymentTokens,
    x402Support: reg.x402Support,
  };
}
export class LocalErc8004Provider implements Erc8004Provider {
  async getIdentity(handle: AgentHandle): Promise<{ deployment: ChainIdentityDeployment; error?: ChainFetchError }> {
    const { chainId, agentId } = handle;
    try {
      const dbRow = await withTransientPoolRetry(() =>
        prisma.agent.findUnique({
          where: { agentId_chainId: { agentId, chainId } },
          select: {
            id: true,
            name: true,
            owner: true,
            agentURI: true,
            isActive: true,
            metadata: { where: { key: "registrations" }, select: { value: true } },
          },
        }),
      );
      let tokenURI = dbRow?.agentURI ?? "";
      let owner = dbRow?.owner ?? "";
      let agentWallet: string | null = null;
      const indexed = Boolean(dbRow?.isActive);
      if (!tokenURI || !owner) {
        const onChain = await fetchOnChainOwnerAndWallet(chainId, agentId);
        if (onChain) {
          owner = owner || onChain.owner;
          agentWallet = onChain.agentWallet;
        }
      }
      if (!tokenURI) {
        const chainConfig = getChainByChainId(chainId);
        const client = buildRpcClient(chainId);
        if (client && chainConfig?.identityRegistry) {
          tokenURI = await client
            .readContract({
              address: chainConfig.identityRegistry as `0x${string}`,
              abi: TOKEN_URI_ABI,
              functionName: "tokenURI",
              args: [BigInt(agentId)],
            })
            .catch(() => "");
        }
      }
      if (!agentWallet && dbRow?.id) {
        const metaWallet = await withTransientPoolRetry(() =>
          prisma.agentMetadata.findFirst({
            where: { agentId: dbRow.id, key: "agentWallet" },
            select: { value: true },
          }),
        );
        agentWallet = metaWallet?.value?.trim() || null;
      }
      const registrationJson = tokenURI ? await fetchAgentRegistrationJson(tokenURI) : null;
      const registrationRefs = registrationRefsFromSources(
        tokenURI,
        dbRow?.metadata[0]?.value,
      );
      return {
        deployment: {
          handle,
          owner,
          agentWallet,
          tokenURI,
          explorerUrl: evmExplorerTokenUrl(chainId, agentId),
          agentCard: agentCardFromRegistration(registrationJson),
          registrationRefs,
          indexed,
          agentDbId: dbRow?.id,
          slug: dbRow?.name ? toAgentUrlSlug(dbRow.name) : undefined,
          profilePath: dbRow?.name ? agentPublicPath({ chainId, agentId, name: dbRow.name }) : undefined,
        },
      };
    } catch (err) {
      return {
        deployment: {
          handle,
          owner: "",
          agentWallet: null,
          tokenURI: "",
          explorerUrl: evmExplorerTokenUrl(chainId, agentId),
          agentCard: null,
          registrationRefs: [],
          indexed: false,
        },
        error: {
          chainId,
          agentId,
          stage: "identity",
          message: Error.isError(err) ? err.message : String(err),
          retryable: true,
        },
      };
    }
  }
  async getReputation(handle: AgentHandle): Promise<{ footprint: ChainReputationFootprint; error?: ChainFetchError }> {
    const { chainId, agentId } = handle;
    const empty: ChainReputationFootprint = {
      handle,
      clients: [],
      rows: [],
      reputationScore: 0,
    };
    const chainConfig = getChainByChainId(chainId);
    const client = buildRpcClient(chainId);
    if (!chainConfig?.reputationRegistry || !client) {
      return { footprint: empty };
    }
    try {
      const clients = (await client.readContract({
        address: chainConfig.reputationRegistry as `0x${string}`,
        abi: REPUTATION_ABI,
        functionName: "getClients",
        args: [BigInt(agentId)],
      })) as string[];
      if (clients.length === 0) return { footprint: empty };
      const result = await client.readContract({
        address: chainConfig.reputationRegistry as `0x${string}`,
        abi: REPUTATION_ABI,
        functionName: "readAllFeedback",
        args: [BigInt(agentId), clients as `0x${string}`[], "", "", false],
      });
      const [
        outClients,
        feedbackIndexes,
        values,
        valueDecimals,
        tag1s,
        tag2s,
        revokedStatuses,
      ] = result as [
        string[],
        bigint[],
        bigint[],
        number[],
        string[],
        string[],
        boolean[],
      ];
      const rows = outClients.map((clientAddress, index) => {
        const feedbackIndex = Number(feedbackIndexes[index] ?? 0);
        const source = feedbackSourceFromIndex(feedbackIndex);
        const normalized = normalizeFeedbackValue(
          Number(values[index] ?? 0),
          Number(valueDecimals[index] ?? 0),
          source,
        );
        return {
          clientAddress,
          value: Number(values[index] ?? 0),
          valueDecimals: Number(valueDecimals[index] ?? 0),
          displayScore: normalized.displayScore,
          tag1: tag1s[index] ?? "",
          tag2: tag2s[index] ?? "",
          revoked: Boolean(revokedStatuses[index]),
          feedbackIndex: Number.isFinite(feedbackIndex) ? feedbackIndex : null,
        };
      });
      return {
        footprint: {
          handle,
          clients: [...clients],
          rows,
          reputationScore: aggregateReputationScore(rows),
        },
      };
    } catch (err) {
      return {
        footprint: empty,
        error: {
          chainId,
          agentId,
          stage: "reputation",
          message: Error.isError(err) ? err.message : String(err),
          retryable: true,
        },
      };
    }
  }
  async getValidation(
    handle: AgentHandle,
    ctx?: Erc8004ProviderContext,
  ): Promise<{ footprint: ChainValidationFootprint; error?: ChainFetchError }> {
    const { chainId, agentId } = handle;
    const empty: ChainValidationFootprint = {
      handle,
      records: [],
      latestPass: null,
      hasRecentPass: false,
    };
    if (ctx?.hydrateValidation === false) {
      const row = await withTransientPoolRetry(() =>
        prisma.agentChainVerification.findUnique({
          where: { chainId_agentId: { chainId, agentId } },
        }),
      );
      if (!row) return { footprint: empty };
      const record = {
        chainId,
        agentId,
        method: "unknown" as const,
        validatorAddress: row.validator,
        requestHash: "",
        responseHash: "",
        responseURI: "",
        requestURI: "",
        score: row.score,
        status: row.verified ? ("passed" as const) : ("failed" as const),
        blockNumber: null,
        logIndex: null,
        txHash: row.txHash,
        attestedAt: row.attestedAt,
        tag: row.tag,
      };
      return {
        footprint: {
          handle,
          records: [record],
          latestPass: row.verified ? record : null,
          hasRecentPass: Boolean(row.verified && row.attestedAt),
        },
      };
    }
    try {
      const footprint = await fetchValidationHistory(chainId, agentId, {
        maxRecords: ctx?.maxValidationRecordsPerChain ?? 50,
      });
      return { footprint };
    } catch (err) {
      return {
        footprint: empty,
        error: {
          chainId,
          agentId,
          stage: "validation",
          message: Error.isError(err) ? err.message : String(err),
          retryable: true,
        },
      };
    }
  }
}
export class QuickNodeErc8004Provider implements Erc8004Provider {
  constructor(private readonly fallback = new LocalErc8004Provider()) {}
  private assertConfigured(): void {
    if (!process.env.QUICKNODE_ERC8004_API_URL?.trim()) {
      throw new Error("QUICKNODE_ERC8004_API_URL is not configured");
    }
  }
  async getIdentity(handle: AgentHandle, _ctx?: Erc8004ProviderContext) {
    try {
      this.assertConfigured();
    } catch {
      return this.fallback.getIdentity(handle);
    }
    return this.fallback.getIdentity(handle);
  }
  async getReputation(handle: AgentHandle) {
    try {
      this.assertConfigured();
    } catch {
      return this.fallback.getReputation(handle);
    }
    return this.fallback.getReputation(handle);
  }
  async getValidation(handle: AgentHandle, ctx?: Erc8004ProviderContext) {
    try {
      this.assertConfigured();
    } catch {
      return this.fallback.getValidation(handle, ctx);
    }
    return this.fallback.getValidation(handle, ctx);
  }
}
export function createErc8004Provider(): Erc8004Provider {
  if (process.env.QUICKNODE_ERC8004_API_URL?.trim()) {
    return new QuickNodeErc8004Provider();
  }
  return new LocalErc8004Provider();
}
