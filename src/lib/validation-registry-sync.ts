import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, http, parseAbiItem, type PublicClient } from "viem";
import { prisma } from "@/lib/db";
import { withTransientPoolRetry } from "@/lib/db-transient-retry";
import { deploymentKey, type DeploymentHandle } from "@/lib/agent-chain-cluster";
import { getChainByChainId } from "@/lib/chains";
import { resolveValidationRegistry } from "@/lib/erc8004-registry-addresses";
import { ERC8004_IDENTITY_DEPLOY_BLOCKS, RPC_URLS } from "@/lib/erc8004-sync";
import { mapWithConcurrency } from "@/lib/async-pool";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import { skipChainVerificationRpc } from "@/lib/fast-local";
import {
  validationVerificationFromLog,
  type ValidationLogArgs,
} from "@/lib/validation-registry-core";
export {
  VALIDATION_PASS_SCORE,
  isChainVerificationPass,
  validationVerificationFromLog,
  type ValidationLogArgs,
} from "@/lib/validation-registry-core";
const VALIDATION_RESPONSE_EVENT = parseAbiItem(
  "event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
);
const DEFAULT_ON_DEMAND_SCAN_BLOCKS = 250_000;
const DEFAULT_GETLOGS_CHUNK = 2_000;
const MIN_GETLOGS_CHUNK = 10;
function getLogsChunkSize(): number {
  const fromEnv = Number.parseInt(process.env.VALIDATION_GETLOGS_CHUNK ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_GETLOGS_CHUNK;
}
function isGetLogsRangeError(message: string): boolean {
  return /range|block|too large|exceed|more than|response size|50 blocks/i.test(message);
}
function isGetLogsRetryableError(message: string): boolean {
  return (
    isGetLogsRangeError(message) ||
    /limit exceeded|usage limit|rate limit|429|too many requests|timeout|503/i.test(message)
  );
}
async function getLogsChunked(
  client: PublicClient,
  params: {
    address: `0x${string}`;
    event: typeof VALIDATION_RESPONSE_EVENT;
    fromBlock: bigint;
    toBlock: bigint;
    args?: { agentId?: bigint };
  },
): Promise<Awaited<ReturnType<PublicClient["getLogs"]>>> {
  const { fromBlock, toBlock, ...rest } = params;
  const logs: Awaited<ReturnType<PublicClient["getLogs"]>> = [];
  let cursor = fromBlock;
  let chunkSize = getLogsChunkSize();
  while (cursor <= toBlock) {
    const chunkEnd =
      cursor + BigInt(chunkSize) - BigInt(1) > toBlock
        ? toBlock
        : cursor + BigInt(chunkSize) - BigInt(1);
    let attempt = 0;
    for (;;) {
      try {
        const batch = await client.getLogs({
          ...rest,
          fromBlock: cursor,
          toBlock: chunkEnd,
        });
        logs.push(...batch);
        cursor = chunkEnd + BigInt(1);
        if (cursor <= toBlock) await delay(15, undefined, { ref: false });
        break;
      } catch (err) {
        const msg = Error.isError(err) ? err.message : String(err);
        if (chunkSize > MIN_GETLOGS_CHUNK && isGetLogsRangeError(msg)) {
          chunkSize = Math.max(MIN_GETLOGS_CHUNK, Math.floor(chunkSize / 2));
          continue;
        }
        if (attempt < 4 && isGetLogsRetryableError(msg)) {
          attempt += 1;
          const retryDelayMs = Math.round(
            500 * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4),
          );
          await delay(retryDelayMs, undefined, { ref: false });
          continue;
        }
        throw err;
      }
    }
  }
  return logs;
}
function chainVerificationRpcEnabled(): boolean {
  if (process.env.CHAIN_VERIFICATION_RPC === "0") return false;
  if (skipChainVerificationRpc()) return false;
  return true;
}
function onDemandScanMaxBlocks(): number {
  const fromEnv = Number.parseInt(process.env.CHAIN_VERIFICATION_RPC_MAX_BLOCKS ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_ON_DEMAND_SCAN_BLOCKS;
}
function onDemandHandleCap(): number {
  const fromEnv = Number.parseInt(process.env.CHAIN_VERIFICATION_RPC_MAX_HANDLES ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 12;
}
function buildValidationClient(chainId: number): PublicClient | null {
  const rpcUrl = RPC_URLS[chainId]?.trim();
  if (!rpcUrl) return null;
  return createPublicClient({
    chain: {
      id: chainId,
      name: String(chainId),
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl, { timeout: 45_000 }),
  });
}
function validationRegistryAddress(chainId: number): `0x${string}` | null {
  const chain = getChainByChainId(chainId);
  if (!chain?.validationRegistry) return null;
  const address = resolveValidationRegistry(chain.identityRegistry);
  return address ? (address as `0x${string}`) : null;
}
function resolveValidationFromBlock(chainId: number, latest: bigint, span: number): bigint {
  const deployBlock = ERC8004_IDENTITY_DEPLOY_BLOCKS[chainId];
  if (process.env.VALIDATION_SYNC_FROM_DEPLOY === "1") {
    return deployBlock ?? latest + 1n;
  }
  const windowStart = latest > BigInt(span) ? latest - BigInt(span) : 0n;
  return deployBlock == null || windowStart > deployBlock ? windowStart : deployBlock;
}
async function upsertChainVerificationRow(row: {
  chainId: number;
  agentId: number;
  verified: boolean;
  score: number;
  validator: string;
  tag: string;
  txHash: string;
}): Promise<void> {
  await withTransientPoolRetry(() =>
    prisma.agentChainVerification.upsert({
      where: { chainId_agentId: { chainId: row.chainId, agentId: row.agentId } },
      create: { ...row, attestedAt: new Date() },
      update: {
        verified: row.verified,
        score: row.score,
        validator: row.validator,
        tag: row.tag,
        attestedAt: new Date(),
        txHash: row.txHash,
      },
    }),
  );
}
/** Latest ValidationResponse for a single agentId (indexed filter). */
export async function fetchLatestChainVerification(
  chainId: number,
  agentId: number,
): Promise<ReturnType<typeof validationVerificationFromLog>> {
  if (chainId === SOLANA_CHAIN_ID) return null;
  const registry = validationRegistryAddress(chainId);
  if (!registry) return null;
  const client = buildValidationClient(chainId);
  if (!client) return null;
  const latest = await client.getBlockNumber();
  const span = onDemandScanMaxBlocks();
  const fromBlock = resolveValidationFromBlock(chainId, latest, span);
  const logs = await getLogsChunked(client, {
    address: registry,
    event: VALIDATION_RESPONSE_EVENT,
    args: { agentId: BigInt(agentId) },
    fromBlock,
    toBlock: latest,
  });
  if (logs.length === 0) return null;
  logs.sort((a, b) => {
    const blockDiff = Number((b.blockNumber ?? BigInt(0)) - (a.blockNumber ?? BigInt(0)));
    if (blockDiff !== 0) return blockDiff;
    return Number((b.logIndex ?? 0) - (a.logIndex ?? 0));
  });
  const latestLog = logs[0] as { args?: ValidationLogArgs; transactionHash?: string | null };
  if (!latestLog.args) return null;
  return validationVerificationFromLog(chainId, latestLog.args, latestLog.transactionHash ?? "");
}
export async function fetchAndPersistChainVerification(
  chainId: number,
  agentId: number,
): Promise<ReturnType<typeof validationVerificationFromLog>> {
  const row = await fetchLatestChainVerification(chainId, agentId);
  if (!row) return null;
  await upsertChainVerificationRow(row);
  return row;
}
/** DB verified map, hydrating missing EVM deployments via RPC when enabled. */
export async function loadChainVerifiedMap(
  handles: readonly DeploymentHandle[],
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (handles.length === 0) return map;
  const rows = await withTransientPoolRetry(() =>
    prisma.agentChainVerification.findMany({
      where: {
        OR: handles.map((h) => ({ chainId: h.chainId, agentId: h.agentId })),
        verified: true,
      },
      select: { chainId: true, agentId: true, verified: true },
    }),
  );
  for (const row of rows) {
    map.set(deploymentKey(row.chainId, row.agentId), row.verified);
  }
  if (!chainVerificationRpcEnabled()) return map;
  const missing = handles.filter((handle) => {
    if (handle.chainId === SOLANA_CHAIN_ID) return false;
    const key = deploymentKey(handle.chainId, handle.agentId);
    if (map.has(key)) return false;
    return Boolean(validationRegistryAddress(handle.chainId));
  });
  if (missing.length === 0) return map;
  const targets = missing.slice(0, onDemandHandleCap());
  await mapWithConcurrency(targets, 3, async (handle) => {
    try {
      const row = await fetchAndPersistChainVerification(handle.chainId, handle.agentId);
      if (row?.verified) {
        map.set(deploymentKey(handle.chainId, handle.agentId), true);
      }
    } catch {
      // RPC miss — leave unverified; worker backfill can catch up later.
    }
  });
  return map;
}
