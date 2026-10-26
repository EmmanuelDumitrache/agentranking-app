import {
  decodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  type PublicClient,
} from "viem";
import { prisma } from "../db.js";
import { canonicalEvmAddress, parseRpcData } from "../lib/exact-protocol.js";
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as const;
const BEACON_ABI = parseAbi(["function implementation() view returns (address)"]);
const VERSION_ABI = parseAbi(["function getVersion() view returns (string)"]);
const ERC165_ABI = parseAbi(["function supportsInterface(bytes4 interfaceId) view returns (bool)"]);
const GENERATION_CACHE_SIZE = 1_024;
const BLOCK_RESOLUTION_CACHE_SIZE = 4_096;
export type ContractGeneration = {
  id: string | null;
  generationKey: string;
  proxyAddress: `0x${string}`;
  implementationAddress: `0x${string}`;
  implementationCodeHash: `0x${string}`;
  beaconAddress: `0x${string}` | null;
  reportedVersion: string | null;
  decoderVersion: string;
  capabilities: Record<string, boolean | string | null>;
};
const cache = new Map<string, ContractGeneration>();
const blockResolutionCache = new Map<string, Promise<ContractGeneration>>();
function retainGeneration(generation: ContractGeneration): void {
  cache.delete(generation.generationKey);
  cache.set(generation.generationKey, generation);
  while (cache.size > GENERATION_CACHE_SIZE) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}
function slotAddress(value: `0x${string}` | undefined): `0x${string}` | null {
  if (!value || value === "0x" || /^0x0+$/.test(value)) return null;
  const hex = value.slice(-40);
  const candidate = `0x${hex}`;
  return isAddress(candidate, { strict: true }) ? getAddress(candidate) : null;
}
async function tryReportedVersion(client: PublicClient, address: `0x${string}`, blockNumber: bigint): Promise<string | null> {
  try {
    const value = await client.readContract({ address, abi: VERSION_ABI, functionName: "getVersion", blockNumber });
    return typeof value === "string" && value.length <= 256 ? value : null;
  } catch {
    return null;
  }
}
async function supportsInterfaceRaw(
  client: PublicClient,
  address: `0x${string}`,
  interfaceId: `0x${string}`,
  blockNumber: bigint,
): Promise<boolean | null> {
  try {
    const data = encodeFunctionData({ abi: ERC165_ABI, functionName: "supportsInterface", args: [interfaceId] });
    const result = await client.call({ to: address, data, blockNumber, gas: 30_000n });
    if (!result.data) return null;
    const [supported] = decodeAbiParameters([{ type: "bool" }], result.data);
    return supported;
  } catch {
    return null;
  }
}
/** Complete ERC-165 conformance check before probing a target interface. */
export async function supportsErc165Interface(
  client: PublicClient,
  address: `0x${string}`,
  interfaceId: `0x${string}`,
  blockNumber: bigint,
): Promise<boolean> {
  const erc165 = await supportsInterfaceRaw(client, address, "0x01ffc9a7", blockNumber);
  const invalid = await supportsInterfaceRaw(client, address, "0xffffffff", blockNumber);
  if (erc165 !== true || invalid !== false) return false;
  return (await supportsInterfaceRaw(client, address, interfaceId, blockNumber)) === true;
}
async function resolveContractGenerationUncached(input: {
  client: PublicClient;
  chainId: number;
  proxyAddress: string;
  blockNumber: bigint;
  blockHash?: string;
  /** Block whose post-state contains the implementation active at the source event position. */
  stateBlockNumber?: bigint;
  effectiveFromTxIndex?: number;
  effectiveFromLogIndex?: number;
  decoderVersion: string;
}): Promise<ContractGeneration> {
  const proxyAddress = canonicalEvmAddress(input.proxyAddress, "registry proxy") as `0x${string}`;
  const stateBlockNumber = input.stateBlockNumber ?? input.blockNumber;
  const [implementationStorage, beaconStorage] = await Promise.all([
    input.client.getStorageAt({ address: proxyAddress, slot: IMPLEMENTATION_SLOT, blockNumber: stateBlockNumber }),
    input.client.getStorageAt({ address: proxyAddress, slot: BEACON_SLOT, blockNumber: stateBlockNumber }),
  ]);
  let implementationAddress = slotAddress(implementationStorage);
  const beaconAddress = implementationAddress ? null : slotAddress(beaconStorage);
  if (!implementationAddress && beaconAddress) {
    implementationAddress = await input.client.readContract({
      address: beaconAddress,
      abi: BEACON_ABI,
      functionName: "implementation",
      blockNumber: stateBlockNumber,
    });
  }
  // Non-proxy deployments are their own implementation generation.
  implementationAddress ??= proxyAddress;
  implementationAddress = canonicalEvmAddress(implementationAddress, "registry implementation") as `0x${string}`;
  const [bytecode, reportedVersion] = await Promise.all([
    input.client.getBytecode({ address: implementationAddress, blockNumber: stateBlockNumber }),
    tryReportedVersion(input.client, proxyAddress, stateBlockNumber),
  ]);
  if (!bytecode || bytecode === "0x") throw new Error(`registry implementation ${implementationAddress} has no bytecode`);
  parseRpcData(bytecode, undefined, "implementation bytecode");
  const implementationCodeHash = keccak256(bytecode);
  const generationKey = [input.chainId, proxyAddress.toLowerCase(), implementationAddress.toLowerCase(), implementationCodeHash, reportedVersion ?? "unknown"].join(":");
  const cached = cache.get(generationKey);
  if (cached) {
    retainGeneration(cached);
    return cached;
  }
  const [erc165Support, invalidInterfaceSupport, erc4906Support] = await Promise.all([
    supportsInterfaceRaw(input.client, proxyAddress, "0x01ffc9a7", stateBlockNumber),
    supportsInterfaceRaw(input.client, proxyAddress, "0xffffffff", stateBlockNumber),
    supportsInterfaceRaw(input.client, proxyAddress, "0x49064906", stateBlockNumber),
  ]);
  const conformsToErc165 = erc165Support === true && invalidInterfaceSupport === false;
  const capabilities = {
    erc165: conformsToErc165,
    erc4906: conformsToErc165 && erc4906Support === true,
  };
  const row = await prisma.evmContractGeneration.upsert({
    where: {
      chainId_proxyAddress_implementationAddress_implementationCodeHash: {
        chainId: input.chainId,
        proxyAddress,
        implementationAddress,
        implementationCodeHash,
      },
    },
    create: {
      chainId: input.chainId,
      proxyAddress,
      implementationAddress,
      implementationCodeHash,
      beaconAddress,
      reportedVersion,
      decoderVersion: input.decoderVersion,
      capabilities,
      effectiveFromBlock: input.blockNumber,
      effectiveFromTxIndex: input.effectiveFromTxIndex ?? 0,
      effectiveFromLogIndex: input.effectiveFromLogIndex ?? 0,
    },
    update: {
      beaconAddress,
      reportedVersion,
      decoderVersion: input.decoderVersion,
      capabilities,
    },
    select: { id: true },
  });
  const id = row.id;
  const generation = {
    id,
    generationKey,
    proxyAddress,
    implementationAddress,
    implementationCodeHash,
    beaconAddress,
    reportedVersion,
    decoderVersion: input.decoderVersion,
    capabilities,
  } satisfies ContractGeneration;
  retainGeneration(generation);
  return generation;
}
export function resolveContractGeneration(input: {
  client: PublicClient;
  chainId: number;
  proxyAddress: string;
  blockNumber: bigint;
  blockHash?: string;
  stateBlockNumber?: bigint;
  effectiveFromTxIndex?: number;
  effectiveFromLogIndex?: number;
  decoderVersion: string;
}): Promise<ContractGeneration> {
  const proxyAddress = canonicalEvmAddress(input.proxyAddress, "registry proxy");
  const stateBlockNumber = input.stateBlockNumber ?? input.blockNumber;
  // An upgrade transaction may intentionally resolve against the preceding
  // block. Without that block's hash it is not safe to retain the result across
  // a reorg, so only memoize the ordinary same-block path.
  if (stateBlockNumber !== input.blockNumber || !input.blockHash) {
    return resolveContractGenerationUncached({ ...input, proxyAddress });
  }
  const resolutionKey = [
    input.chainId,
    proxyAddress.toLowerCase(),
    input.blockHash?.toLowerCase() ?? stateBlockNumber.toString(10),
    input.decoderVersion,
  ].join(":");
  const cached = blockResolutionCache.get(resolutionKey);
  if (cached) {
    // Refresh insertion order so a busy recent block survives bounded eviction.
    blockResolutionCache.delete(resolutionKey);
    blockResolutionCache.set(resolutionKey, cached);
    return cached;
  }
  const pending = resolveContractGenerationUncached({ ...input, proxyAddress });
  blockResolutionCache.set(resolutionKey, pending);
  if (blockResolutionCache.size > BLOCK_RESOLUTION_CACHE_SIZE) {
    const oldest = blockResolutionCache.keys().next().value;
    if (oldest !== undefined) blockResolutionCache.delete(oldest);
  }
  void pending.catch(() => {
    if (blockResolutionCache.get(resolutionKey) === pending) {
      blockResolutionCache.delete(resolutionKey);
    }
  });
  return pending;
}
export function clearContractGenerationCache(proxyAddress?: string): void {
  if (!proxyAddress) {
    cache.clear();
    blockResolutionCache.clear();
    return;
  }
  const normalized = canonicalEvmAddress(proxyAddress).toLowerCase();
  for (const [key, value] of cache) if (value.proxyAddress.toLowerCase() === normalized) cache.delete(key);
  for (const key of blockResolutionCache.keys()) {
    if (key.includes(`:${normalized}:`)) blockResolutionCache.delete(key);
  }
}
