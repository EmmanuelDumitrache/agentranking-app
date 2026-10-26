import "server-only";
import type { ChainConfig } from "@/lib/chains";
import type { CreateAgentPageConfig } from "@/lib/public-launch/create-agent-config";
import {
  mainnetLaunchChains,
  testnetLaunchChains,
} from "@/lib/launch/constants";

function serializeChain(chain: ChainConfig): ChainConfig {
  return {
    chainId: chain.chainId,
    name: chain.name,
    shortName: chain.shortName,
    icon: chain.icon,
    color: chain.color,
    identityRegistry: chain.identityRegistry,
    reputationRegistry: chain.reputationRegistry,
    validationRegistry: chain.validationRegistry,
    isActive: chain.isActive,
  };
}

export function readCreateAgentPageConfig(): CreateAgentPageConfig {
  return {
    mainnetChains: mainnetLaunchChains.map(serializeChain),
    testnetChains: testnetLaunchChains.map(serializeChain),
  };
}
