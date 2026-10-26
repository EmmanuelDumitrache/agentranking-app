import { prisma } from "@/lib/db";
import { loadAgentWalletDashboardBalances } from "@/lib/dashboard/agent-overview";
import { resolveAgentWallet } from "@/lib/custodial-wallet/agent-wallet-resolve";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { valkeyDeleteKeys, valkeyGetJson, valkeySetJson } from "@/lib/valkey";

export type WalletBalances = {
  publicKey: string | null;
  isCustodial: boolean;
  network: string;
  solBalanceLamports: number | null;
  usdcBalance: { amount: string; decimals: number } | null;
  arBalance: { amount: string; decimals: number } | null;
};

const BALANCE_CACHE_TTL_SECONDS = 15;

function balanceCacheKey(agentDbId: number): string {
  return `agent-wallet-balance:v1:${agentDbId}`;
}

function isTokenBalance(value: unknown): value is { amount: string; decimals: number } | null {
  if (value === null) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.amount === "string" && typeof row.decimals === "number" && Number.isSafeInteger(row.decimals);
}

function isWalletBalances(value: unknown): value is WalletBalances {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    (row.publicKey === null || typeof row.publicKey === "string") &&
    typeof row.isCustodial === "boolean" &&
    typeof row.network === "string" &&
    (row.solBalanceLamports === null ||
      (typeof row.solBalanceLamports === "number" && Number.isSafeInteger(row.solBalanceLamports))) &&
    isTokenBalance(row.usdcBalance) &&
    isTokenBalance(row.arBalance)
  );
}

export async function getWalletBalances(agentDbId: number): Promise<WalletBalances> {
  const key = balanceCacheKey(agentDbId);
  const cached = await valkeyGetJson<unknown>(key);
  if (isWalletBalances(cached)) return cached;
  if (cached !== null) await valkeyDeleteKeys([key]);

  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      owner: true,
      listingRegistrySource: true,
      chainId: true,
    },
  });
  if (!agent) {
    return {
      publicKey: null,
      isCustodial: false,
      network: "solana",
      solBalanceLamports: null,
      usdcBalance: null,
      arBalance: null,
    };
  }
  const metadataRow = await prisma.agentMetadata.findFirst({
    where: { agentId: agentDbId, key: "agentWallet" },
    select: { value: true },
  });
  const resolved = await resolveAgentWallet(agentDbId, {
    owner: agent.owner,
    listingRegistrySource: agent.listingRegistrySource ?? "",
    chainId: agent.chainId,
    metadataWallet: metadataRow?.value ?? null,
  });
  if (!resolved) {
    return {
      publicKey: null,
      isCustodial: false,
      network: getAgentLaunchConfig().network ?? "solana",
      solBalanceLamports: null,
      usdcBalance: null,
      arBalance: null,
    };
  }

  const network = getAgentLaunchConfig().network ?? "solana";
  const { solBalanceLamports, usdcBalanceRaw, arBalanceRaw } =
    await loadAgentWalletDashboardBalances(resolved.publicKey);
  const value: WalletBalances = {
    publicKey: resolved.publicKey,
    isCustodial: resolved.isCustodial,
    network,
    solBalanceLamports,
    usdcBalance: usdcBalanceRaw != null ? { amount: usdcBalanceRaw.toString(), decimals: 6 } : null,
    arBalance: arBalanceRaw != null ? { amount: arBalanceRaw.toString(), decimals: 6 } : null,
  };
  if (solBalanceLamports != null) await valkeySetJson(key, value, BALANCE_CACHE_TTL_SECONDS);
  return value;
}

export async function invalidateWalletBalanceCache(agentDbId: number): Promise<void> {
  await valkeyDeleteKeys([balanceCacheKey(agentDbId)]);
}
