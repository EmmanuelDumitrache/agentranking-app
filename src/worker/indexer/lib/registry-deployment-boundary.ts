import type { Hex } from "viem";
import { prisma } from "../db.js";
import {
  type ChainConfig,
  type EvmRegistryDomain,
  provenRegistryDeploymentBlock,
  registryAddress,
  registryDeploymentSearchHint,
} from "../chains.js";
import { canonicalEvmAddress } from "./exact-protocol.js";
import { throwIfAborted } from "./abort.js";
import { findFirstBlockContainingCode } from "./registry-deployment-search.js";
import { RpcFinalityUnavailableError, withRpcFallback } from "../sync/rpc.js";
import { logger } from "../logger.js";

const CACHE_VERSION = 1;
type BoundaryCache = {
  v: typeof CACHE_VERSION;
  registryDeploymentBoundary: {
    chainId: number;
    domain: EvmRegistryDomain;
    registryAddress: string;
    deploymentBlock: string;
    method: "archive-eth_getCode-binary-search";
    provenAtFinalizedBlock: string;
    provenAt: string;
  };
};

const processCache = new Map<string, bigint>();

function hasCode(value: Hex | undefined): boolean {
  return value != null && value !== "0x";
}

function parseCachedBoundary(raw: string | null, input: {
  chainId: number;
  domain: EvmRegistryDomain;
  registryAddress: string;
}): bigint | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BoundaryCache>;
    const boundary = parsed.registryDeploymentBoundary;
    if (parsed.v !== CACHE_VERSION || !boundary) return null;
    if (boundary.chainId !== input.chainId || boundary.domain !== input.domain) return null;
    if (boundary.registryAddress.toLowerCase() !== input.registryAddress.toLowerCase()) return null;
    const value = BigInt(boundary.deploymentBlock);
    return value >= 0n ? value : null;
  } catch {
    return null;
  }
}

async function codeAt(input: {
  chainId: number;
  registryAddress: `0x${string}`;
  blockNumber: bigint;
  finalizedHead: bigint;
  finalizedHash?: `0x${string}`;
  signal?: AbortSignal;
}): Promise<boolean> {
  throwIfAborted(input.signal);
  const bytecode = await withRpcFallback(
    input.chainId,
    (client) => client.getBytecode({ address: input.registryAddress, blockNumber: input.blockNumber }),
    {
      blockNumber: input.blockNumber,
      blockHash: input.blockNumber === input.finalizedHead ? input.finalizedHash : undefined,
      requiresArchive: input.blockNumber < input.finalizedHead,
      signal: input.signal,
    },
  );
  return hasCode(bytecode);
}

async function persistBoundary(input: {
  sourceKey: string;
  registryGeneration: string;
  chainId: number;
  domain: EvmRegistryDomain;
  registryAddress: string;
  deploymentBlock: bigint;
  finalizedHead: bigint;
}): Promise<void> {
  const opaqueCursor = JSON.stringify({
    v: CACHE_VERSION,
    registryDeploymentBoundary: {
      chainId: input.chainId,
      domain: input.domain,
      registryAddress: input.registryAddress,
      deploymentBlock: input.deploymentBlock.toString(10),
      method: "archive-eth_getCode-binary-search",
      provenAtFinalizedBlock: input.finalizedHead.toString(10),
      provenAt: new Date().toISOString(),
    },
  } satisfies BoundaryCache);
  await prisma.indexerSourceCursor.upsert({
    where: { sourceKey: input.sourceKey },
    create: {
      sourceKey: input.sourceKey,
      chainId: input.chainId,
      domain: input.domain,
      registryAddress: input.registryAddress,
      registryGeneration: input.registryGeneration,
      opaqueCursor,
    },
    update: {
      chainId: input.chainId,
      domain: input.domain,
      registryAddress: input.registryAddress,
      registryGeneration: input.registryGeneration,
      opaqueCursor,
    },
  });
}

/**
 * Resolves the first finalized block whose post-state contains registry bytecode.
 * Static blocks are machine-verified configuration. Dynamic blocks are proven by
 * archival eth_getCode lower-bound search and cached only after both sides of the
 * creation boundary have been checked.
 */
export async function resolveRegistryDeploymentBoundary(input: {
  chain: ChainConfig;
  domain: EvmRegistryDomain;
  sourceKey: string;
  registryGeneration: string;
  finalizedHead: bigint;
  finalizedHash?: `0x${string}`;
  signal?: AbortSignal;
}): Promise<bigint> {
  throwIfAborted(input.signal);
  const address = canonicalEvmAddress(registryAddress(input.chain, input.domain)) as `0x${string}`;
  const shared = {
    chainId: input.chain.chainId,
    registryAddress: address,
    finalizedHead: input.finalizedHead,
    finalizedHash: input.finalizedHash,
    signal: input.signal,
  };

  // A missing registry is a deliberate no-op. Do not cache it so a future deployment is detected.
  if (!(await codeAt({ ...shared, blockNumber: input.finalizedHead }))) {
    processCache.delete(input.sourceKey);
    return input.finalizedHead + 1n;
  }

  const configured = provenRegistryDeploymentBlock(input.chain, input.domain);
  if (configured != null) {
    if (configured > input.finalizedHead) return input.finalizedHead + 1n;
    return configured;
  }

  const memoryCached = processCache.get(input.sourceKey);
  if (memoryCached != null && memoryCached <= input.finalizedHead) return memoryCached;

  const cursor = await prisma.indexerSourceCursor.findUnique({
    where: { sourceKey: input.sourceKey },
    select: { opaqueCursor: true },
  });
  const persisted = parseCachedBoundary(cursor?.opaqueCursor ?? null, {
    chainId: input.chain.chainId,
    domain: input.domain,
    registryAddress: address,
  });
  if (persisted != null && persisted <= input.finalizedHead) {
    processCache.set(input.sourceKey, persisted);
    return persisted;
  }

  const hint = registryDeploymentSearchHint(input.chain, input.domain);
  let low = 0n;
  let high = input.finalizedHead;
  if (hint > 0n && hint < input.finalizedHead) {
    if (await codeAt({ ...shared, blockNumber: hint })) high = hint;
    else low = hint + 1n;
  }

  const deploymentBlock = await findFirstBlockContainingCode({
    low,
    high,
    signal: input.signal,
    hasCodeAt: (blockNumber) => codeAt({ ...shared, blockNumber }),
  });
  if (!(await codeAt({ ...shared, blockNumber: deploymentBlock }))) {
    throw new RpcFinalityUnavailableError(
      "rpc_archive_unavailable",
      `registry deployment boundary proof failed at block ${deploymentBlock}`,
    );
  }
  if (deploymentBlock > 0n && await codeAt({ ...shared, blockNumber: deploymentBlock - 1n })) {
    throw new RpcFinalityUnavailableError(
      "rpc_archive_unavailable",
      `registry deployment boundary proof failed before block ${deploymentBlock}`,
    );
  }

  await persistBoundary({
    sourceKey: input.sourceKey,
    registryGeneration: input.registryGeneration,
    chainId: input.chain.chainId,
    domain: input.domain,
    registryAddress: address,
    deploymentBlock,
    finalizedHead: input.finalizedHead,
  });
  processCache.set(input.sourceKey, deploymentBlock);
  logger.info("registry deployment boundary discovered", {
    chainId: input.chain.chainId,
    domain: input.domain,
    registryAddress: address,
    deploymentBlock: deploymentBlock.toString(10),
    finalizedHead: input.finalizedHead.toString(10),
  }, "sync");
  return deploymentBlock;
}

export function clearRegistryDeploymentBoundaryCache(sourceKey?: string): void {
  if (sourceKey) processCache.delete(sourceKey);
  else processCache.clear();
}
