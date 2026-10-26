import { getChainByChainId, isErc8004IndexingEnabled, registryDeploymentSearchHint } from "../chains.js";
import { registrySourceKey, WORKER_CONFIGURATION_GENERATION } from "./source-cursor.js";
export type EvmSourceDomain = "identity" | "reputation" | "validation";
const EVENT_SIGNATURES: Record<EvmSourceDomain, string> = {
  identity: "erc8004.identity.events.v2",
  reputation: "erc8004.reputation.events.v2",
  validation: "erc8004.validation.events.v2",
};
type EvmSourceDescriptor = {
  chainId: number;
  domain: EvmSourceDomain;
  registryAddress: string;
  registryGeneration: string;
  configurationGeneration: string;
  sourceKey: string;
  deploymentSearchHint: bigint;
};
const descriptorCache = new Map<string, EvmSourceDescriptor>();
export function currentEvmSourceDescriptor(chainId: number, domain: EvmSourceDomain): EvmSourceDescriptor {
  const cacheKey = `${chainId}:${domain}`;
  const cached = descriptorCache.get(cacheKey);
  if (cached) return cached;
  const chain = getChainByChainId(chainId);
  if (!chain) throw new Error(`unsupported chain ${chainId}`);
  if (!isErc8004IndexingEnabled(chain)) throw new Error(`ERC-8004 indexing is disabled for chain ${chainId}`);
  const registryAddress = domain === "identity"
    ? chain.identityRegistry
    : domain === "reputation"
      ? chain.reputationRegistry
      : chain.validationRegistry;
  if (!registryAddress) throw new Error(`${domain} registry is not configured for chain ${chainId}`);
  const deploymentSearchHint = registryDeploymentSearchHint(chain, domain);
  const identity = registrySourceKey({
    chainId,
    domain,
    registryAddress,
    eventSignature: EVENT_SIGNATURES[domain],
    deploymentBlock: deploymentSearchHint,
  });
  const descriptor = {
    chainId,
    domain,
    registryAddress,
    registryGeneration: identity.registryGeneration,
    configurationGeneration: WORKER_CONFIGURATION_GENERATION,
    sourceKey: identity.sourceKey,
    deploymentSearchHint,
  };
  descriptorCache.set(cacheKey, descriptor);
  return descriptor;
}
