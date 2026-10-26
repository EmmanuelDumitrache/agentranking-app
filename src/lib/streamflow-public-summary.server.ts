import "server-only";
import { createHash } from "node:crypto";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  createTimedSolanaConnection,
  createTimedSolanaConnectionConfig,
} from "@/lib/solana-rpc-connection.server";
import { SolanaStakingClient } from "@streamflow/staking";
import {
  getExternalProviderCached,
  readExternalProviderCache,
  writeExternalProviderCache,
} from "@/lib/external-provider-cache";
import {
  resolveArSolanaMint,
  resolveArTokenDecimals,
} from "@/lib/ar-token-public";
import {
  publicStreamflowStakePoolAddresses,
  resolveArBonusRewardsVault,
  streamflowICluster,
  streamflowPublicClusterRpcEndpoint,
  streamflowRewardVaultOwners,
} from "@/lib/streamflow-stake-config";
import { isSolanaRpcRateLimitError } from "@/lib/solana-rpc-errors";
export type StreamflowPublicSummary = {
  totalStakedAr: number;
  activeStakers: number;
  /** $AR currently sitting in Streamflow reward vaults (funded for stakers). */
  stakingRewardsAr: number;
  /** $AR currently held by the bonus rewards vault. */
  bonusRewardsVaultAr: number;
  readAt: string;
};
type NumberLike = {
  toString(): string;
};
type StakeEntryAccount = {
  payer: PublicKey;
  closedTs: NumberLike;
};
const ON_CHAIN_CACHE_SECONDS = 45;
const ON_CHAIN_STALE_SECONDS = 5 * 60;
const MAX_CACHE_BYTES = 16 * 1_024;
const RPC_TIMEOUT_MS = 16_000;
const RATE_LIMIT_COOLDOWN_SECONDS = 60;
const RATE_LIMIT_MARKER_MAX_BYTES = 2 * 1_024;

type StreamflowRateLimitMarker = {
  limitedAt: string;
};

class StreamflowRateLimitCooldownError extends Error {
  constructor(options?: ErrorOptions) {
    super("Streamflow Solana RPC is in a short rate-limit cooldown", options);
    this.name = "StreamflowRateLimitCooldownError";
  }
}

function isStreamflowRateLimitMarker(value: unknown): value is StreamflowRateLimitMarker {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const limitedAt = (value as { limitedAt?: unknown }).limitedAt;
  return typeof limitedAt === "string" && Number.isFinite(Date.parse(limitedAt));
}
function rawAmountToUi(raw: NumberLike, decimals: number): number {
  const value = BigInt(raw.toString());
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const uiText = fractionText ? `${whole}.${fractionText}` : whole.toString();
  const parsed = Number(uiText);
  return Number.isFinite(parsed) ? parsed : 0;
}
async function readOwnerArBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<number> {
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
    mint,
  });
  let total = 0;
  for (const row of accounts.value) {
    const amount = Number(
      row.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0,
    );
    if (Number.isFinite(amount) && amount > 0) total += amount;
  }
  return total;
}
async function readStreamflowPublicSummaryUncached(
  parentSignal?: AbortSignal,
): Promise<StreamflowPublicSummary> {
  const poolAddresses = publicStreamflowStakePoolAddresses();
  const poolKeys = poolAddresses.map((address) => new PublicKey(address));
  const arMint = new PublicKey(resolveArSolanaMint());
  const rpcUrl = streamflowPublicClusterRpcEndpoint();
  const timeoutSignal = AbortSignal.timeout(RPC_TIMEOUT_MS);
  const rpcDeadline = parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
  const connectionConfig = createTimedSolanaConnectionConfig({
    commitment: "confirmed",
    signal: rpcDeadline,
  });
  const client = new SolanaStakingClient({
    clusterUrl: rpcUrl,
    cluster: streamflowICluster(),
    commitment: connectionConfig,
  });
  const connection = createTimedSolanaConnection(rpcUrl, {
    commitment: "confirmed",
    signal: rpcDeadline,
  });
  const bonusVault = new PublicKey(resolveArBonusRewardsVault());
  const rewardOwners = streamflowRewardVaultOwners().map(
    (address) => new PublicKey(address),
  );
  // Read each official pool by address. `searchStakePools({ mint })` scans the
  // whole program and times out on public RPC, which made the homepage show 0.
  const [poolAccounts, entryRows, bonusRewardsVaultAr, ...rewardVaultBalances] =
    await Promise.all([
      Promise.all(poolKeys.map((poolKey) => client.getStakePool(poolKey))),
      Promise.all(
        poolKeys.map((poolKey) => client.searchStakeEntries({ stakePool: poolKey })),
      ),
      readOwnerArBalance(connection, bonusVault, arMint),
      ...rewardOwners.map((owner) =>
        readOwnerArBalance(connection, owner, arMint),
      ),
    ]);
  let totalStakedRaw = BigInt(0);
  for (const pool of poolAccounts) {
    totalStakedRaw += BigInt(pool.totalStake.toString());
  }
  const activeWallets = new Set<string>();
  for (const entries of entryRows) {
    for (const row of entries) {
      const account = row.account as StakeEntryAccount;
      if (account.closedTs.toString() !== "0") continue;
      activeWallets.add(account.payer.toBase58());
    }
  }
  const snapshot = {
    activeWallets,
    bonusRewardsVaultAr,
    stakingRewardsAr: rewardVaultBalances.reduce(
      (sum, amount) => sum + amount,
      0,
    ),
    totalStakedRaw,
  };
  const decimals = resolveArTokenDecimals();
  return {
    totalStakedAr: rawAmountToUi(
      { toString: () => snapshot.totalStakedRaw.toString() },
      decimals,
    ),
    activeStakers: snapshot.activeWallets.size,
    stakingRewardsAr: snapshot.stakingRewardsAr,
    bonusRewardsVaultAr: snapshot.bonusRewardsVaultAr,
    readAt: new Date().toISOString(),
  };
}
function isStreamflowPublicSummary(value: unknown): value is StreamflowPublicSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Partial<StreamflowPublicSummary>;
  return (
    [row.totalStakedAr, row.activeStakers, row.stakingRewardsAr, row.bonusRewardsVaultAr].every(
      (amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0,
    ) &&
    typeof row.readAt === "string" &&
    Number.isFinite(Date.parse(row.readAt))
  );
}
function streamflowSummaryCacheKey(): string {
  const configuration = JSON.stringify({
    pools: publicStreamflowStakePoolAddresses(),
    mint: resolveArSolanaMint(),
    bonusVault: resolveArBonusRewardsVault(),
    rewardOwners: streamflowRewardVaultOwners(),
    cluster: streamflowICluster(),
    rpc: streamflowPublicClusterRpcEndpoint(),
  });
  return `streamflow:public-summary:${createHash("sha256").update(configuration).digest("hex").slice(0, 20)}`;
}
function streamflowRateLimitKey(summaryKey: string): string {
  return `${summaryKey}:rate-limit`;
}

async function readStreamflowRateLimitMarker(
  summaryKey: string,
): Promise<StreamflowRateLimitMarker | null> {
  const cached = await readExternalProviderCache({
    key: streamflowRateLimitKey(summaryKey),
    validate: isStreamflowRateLimitMarker,
    freshTtlSeconds: RATE_LIMIT_COOLDOWN_SECONDS,
    staleTtlSeconds: RATE_LIMIT_COOLDOWN_SECONDS,
    maxPayloadBytes: RATE_LIMIT_MARKER_MAX_BYTES,
  });
  return cached?.status === "fresh" ? cached.value : null;
}

async function recordStreamflowRateLimit(summaryKey: string): Promise<void> {
  try {
    await writeExternalProviderCache({
      key: streamflowRateLimitKey(summaryKey),
      value: { limitedAt: new Date().toISOString() },
      validate: isStreamflowRateLimitMarker,
      freshTtlSeconds: RATE_LIMIT_COOLDOWN_SECONDS,
      staleTtlSeconds: RATE_LIMIT_COOLDOWN_SECONDS,
      maxPayloadBytes: RATE_LIMIT_MARKER_MAX_BYTES,
    });
  } catch (error) {
    console.warn("[streamflow-public-summary] failed to persist RPC rate-limit cooldown", {
      error: Error.isError(error) ? error.message : String(error),
    });
  }
}
export async function readStreamflowPublicSummary(): Promise<StreamflowPublicSummary | null> {
  if (publicStreamflowStakePoolAddresses().length === 0) return null;
  const key = streamflowSummaryCacheKey();
  const cached = await readExternalProviderCache({
    key,
    validate: isStreamflowPublicSummary,
    freshTtlSeconds: ON_CHAIN_CACHE_SECONDS,
    staleTtlSeconds: ON_CHAIN_STALE_SECONDS,
    maxPayloadBytes: MAX_CACHE_BYTES,
  });
  if (cached?.status === "fresh") return cached.value;
  if (await readStreamflowRateLimitMarker(key)) return cached?.value ?? null;

  try {
    const result = await getExternalProviderCached({
      key,
      validate: isStreamflowPublicSummary,
      freshTtlSeconds: ON_CHAIN_CACHE_SECONDS,
      staleTtlSeconds: ON_CHAIN_STALE_SECONDS,
      maxPayloadBytes: MAX_CACHE_BYTES,
      leaseTtlMs: RPC_TIMEOUT_MS + 5_000,
      leaseWaitMs: 2_000,
      load: async (signal) => {
        if (await readStreamflowRateLimitMarker(key)) {
          throw new StreamflowRateLimitCooldownError();
        }
        try {
          return await readStreamflowPublicSummaryUncached(signal);
        } catch (error) {
          if (isSolanaRpcRateLimitError(error)) {
            await recordStreamflowRateLimit(key);
            throw new StreamflowRateLimitCooldownError({ cause: error });
          }
          throw error;
        }
      },
    });
    return result.value;
  } catch (error) {
    if (!(error instanceof StreamflowRateLimitCooldownError)) {
      console.error("[streamflow-public-summary] on-chain read failed:", error);
    }
    return cached?.value ?? null;
  }
}
