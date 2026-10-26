import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, http, type PublicClient } from "viem";
import { ERC8004_IDENTITY_DEPLOY_BLOCKS, RPC_URLS } from "@/lib/erc8004-sync";
import { getChainByChainId } from "@/lib/chains";
import { resolveValidationRegistry } from "@/lib/erc8004-registry-addresses";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
import {
  VALIDATION_PASS_SCORE,
  VALIDATION_REQUEST_EVENT,
  VALIDATION_RESPONSE_EVENT,
  type ValidationLogArgs,
} from "@/lib/validation-registry-core";
import {
  mergeValidationRecords,
  toValidationRecordFromRequestLog,
  toValidationRecordFromResponseLog,
  type ValidationRequestLogArgs,
} from "@/types/agent-mappers";
import type { ChainValidationFootprint, ValidationRecord } from "@/types/agent";
const DEFAULT_SCAN_BLOCKS = 250_000;
const DEFAULT_GETLOGS_CHUNK = 2_000;
const MIN_GETLOGS_CHUNK = 10;
const RECENT_PASS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
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
    event: typeof VALIDATION_REQUEST_EVENT | typeof VALIDATION_RESPONSE_EVENT;
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
function resolveFromBlock(chainId: number, latest: bigint, span: number): bigint {
  const deployBlock = ERC8004_IDENTITY_DEPLOY_BLOCKS[chainId];
  if (process.env.VALIDATION_SYNC_FROM_DEPLOY === "1") {
    return deployBlock ?? latest + 1n;
  }
  const windowStart = latest > BigInt(span) ? latest - BigInt(span) : 0n;
  return deployBlock == null || windowStart > deployBlock ? windowStart : deployBlock;
}
function buildValidationFootprint(
  chainId: number,
  agentId: number,
  records: ValidationRecord[],
  recentWindowMs = RECENT_PASS_WINDOW_MS,
): ChainValidationFootprint {
  const now = Date.now();
  const passes = records.filter((row) => row.status === "passed" && (row.score ?? 0) >= VALIDATION_PASS_SCORE);
  const latestPass = passes[0] ?? null;
  const hasRecentPass = passes.some((row) => {
    if (!row.attestedAt) return false;
    return now - row.attestedAt.getTime() <= recentWindowMs;
  });
  return {
    handle: { chainId, agentId },
    records,
    latestPass,
    hasRecentPass,
  };
}
/** Fetch ValidationRequest + ValidationResponse logs and merge by requestHash. */
export async function fetchValidationHistory(
  chainId: number,
  agentId: number,
  options?: { maxBlocks?: number; maxRecords?: number },
): Promise<ChainValidationFootprint> {
  if (chainId === SOLANA_CHAIN_ID) {
    return buildValidationFootprint(chainId, agentId, []);
  }
  const registry = validationRegistryAddress(chainId);
  if (!registry) return buildValidationFootprint(chainId, agentId, []);
  const client = buildValidationClient(chainId);
  if (!client) return buildValidationFootprint(chainId, agentId, []);
  const span =
    options?.maxBlocks ??
    (Number.parseInt(process.env.CHAIN_VERIFICATION_RPC_MAX_BLOCKS ?? "", 10) || DEFAULT_SCAN_BLOCKS);
  const latest = await client.getBlockNumber();
  const fromBlock = resolveFromBlock(chainId, latest, span);
  const agentIdFilter = { agentId: BigInt(agentId) };
  const [requestLogs, responseLogs] = await Promise.all([
    getLogsChunked(client, {
      address: registry,
      event: VALIDATION_REQUEST_EVENT,
      args: agentIdFilter,
      fromBlock,
      toBlock: latest,
    }),
    getLogsChunked(client, {
      address: registry,
      event: VALIDATION_RESPONSE_EVENT,
      args: agentIdFilter,
      fromBlock,
      toBlock: latest,
    }),
  ]);
  type DecodedRequestLog = {
    args: ValidationRequestLogArgs;
    blockNumber: bigint | null;
    logIndex: number | null;
    transactionHash: `0x${string}` | null;
  };
  type DecodedResponseLog = {
    args: ValidationLogArgs;
    blockNumber: bigint | null;
    logIndex: number | null;
    transactionHash: `0x${string}` | null;
  };
  const requests = requestLogs
    .map((log) => {
      const decoded = log as DecodedRequestLog;
      if (!decoded.args) return null;
      return toValidationRecordFromRequestLog(chainId, decoded.args, {
        blockNumber: decoded.blockNumber,
        logIndex: decoded.logIndex != null ? BigInt(decoded.logIndex) : null,
        transactionHash: decoded.transactionHash,
      });
    })
    .filter((row): row is ValidationRecord => row != null);
  const responses = responseLogs
    .map((log) => {
      const decoded = log as unknown as DecodedResponseLog & {
        args: ValidationLogArgs & {
          requestHash?: string | null;
          responseURI?: string | null;
          responseHash?: string | null;
        };
      };
      if (!decoded.args) return null;
      return toValidationRecordFromResponseLog(chainId, decoded.args, {
        blockNumber: decoded.blockNumber,
        logIndex: decoded.logIndex != null ? BigInt(decoded.logIndex) : null,
        transactionHash: decoded.transactionHash,
        requestHash: decoded.args.requestHash,
        responseURI: decoded.args.responseURI,
        responseHash: decoded.args.responseHash,
      });
    })
    .filter((row): row is ValidationRecord => row != null);
  const merged = mergeValidationRecords(requests, responses);
  const cap = options?.maxRecords ?? 50;
  return buildValidationFootprint(chainId, agentId, merged.slice(0, cap));
}