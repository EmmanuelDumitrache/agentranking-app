import {
  ARC_TESTNET_CHAIN_ID,
  SOLANA_AGENT_REGISTRY_PROGRAM,
  SOLANA_ATOM_ENGINE_PROGRAM,
  SOLANA_CHAIN_ID,
} from "./chain-constants.js";

export interface ChainConfig {
  chainId: number;
  name: string;
  shortName: string;
  identityRegistry: string;
  reputationRegistry: string;
  validationRegistry: string;
  /** Search hint only. It is never an authoritative scan floor unless a registry-specific proven block is present. */
  deploymentSearchHint: bigint;
  /** Machine-verified registry creation blocks. Missing values require runtime archival discovery. */
  identityDeploymentBlock?: bigint;
  reputationDeploymentBlock?: bigint;
  validationDeploymentBlock?: bigint;
  /** Disabled chains remain visible in product metadata but are excluded from ERC-8004 worker fan-out. */
  erc8004IndexingEnabled?: boolean;
}

export type EvmRegistryDomain = "identity" | "reputation" | "validation";

export function registryAddress(chain: ChainConfig, domain: EvmRegistryDomain): string {
  if (domain === "identity") return chain.identityRegistry;
  if (domain === "reputation") return chain.reputationRegistry;
  return chain.validationRegistry;
}

/** Returns a proven static block when available; otherwise the configured search hint. Never use directly as a scan floor. */
export function registryDeploymentSearchHint(chain: ChainConfig, domain: EvmRegistryDomain): bigint {
  return provenRegistryDeploymentBlock(chain, domain) ?? chain.deploymentSearchHint;
}

export function provenRegistryDeploymentBlock(chain: ChainConfig, domain: EvmRegistryDomain): bigint | null {
  if (domain === "identity") return chain.identityDeploymentBlock ?? null;
  if (domain === "reputation") return chain.reputationDeploymentBlock ?? null;
  return chain.validationDeploymentBlock ?? null;
}

export function isErc8004IndexingEnabled(chain: ChainConfig): boolean {
  return chain.chainId !== SOLANA_CHAIN_ID && chain.erc8004IndexingEnabled !== false;
}

const IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const REPUTATION = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";
const VALIDATION = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272";
const TESTNET_IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const TESTNET_REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const TESTNET_VALIDATION = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272";

export const CHAINS: ChainConfig[] = [
  { chainId: 1, name: "Ethereum", shortName: "ETH", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 24_339_871n, identityDeploymentBlock: 24_339_871n },
  { chainId: 56, name: "BNB Smart Chain", shortName: "BSC", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 79_027_268n, identityDeploymentBlock: 79_027_268n },
  { chainId: 100, name: "Gnosis", shortName: "GNO", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 44_505_010n, identityDeploymentBlock: 44_505_010n },
  { chainId: 137, name: "Polygon", shortName: "MATIC", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 82_458_484n, identityDeploymentBlock: 82_458_484n },
  { chainId: 8453, name: "Base", shortName: "BASE", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 41_663_783n, identityDeploymentBlock: 41_663_783n },
  { chainId: 42161, name: "Arbitrum", shortName: "ARB", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 428_895_443n, identityDeploymentBlock: 428_895_443n },
  { chainId: 42220, name: "Celo", shortName: "CELO", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 58_396_724n, identityDeploymentBlock: 58_396_724n },
  { chainId: 43114, name: "Avalanche", shortName: "AVAX", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 58_000_000n },
  { chainId: 59144, name: "Linea", shortName: "LINEA", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 18_000_000n },
  { chainId: 534352, name: "Scroll", shortName: "SCROLL", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 15_000_000n },
  { chainId: 10, name: "Optimism", shortName: "OP", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 147_514_947n, identityDeploymentBlock: 147_514_947n },
  { chainId: 5000, name: "Mantle", shortName: "MNT", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 91_333_846n, identityDeploymentBlock: 91_333_846n },
  { chainId: 143, name: "Monad", shortName: "MONAD", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 52_952_790n, identityDeploymentBlock: 52_952_790n },
  { chainId: 167000, name: "Taiko", shortName: "TAIKO", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 4_305_747n, identityDeploymentBlock: 4_305_747n },
  { chainId: 9745, name: "Plasma", shortName: "PLASMA", identityRegistry: "", reputationRegistry: "", validationRegistry: "", deploymentSearchHint: 0n, erc8004IndexingEnabled: false },
  { chainId: 4326, name: "MegaETH", shortName: "MEGA", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 7_833_805n, identityDeploymentBlock: 7_833_805n },
  { chainId: 2741, name: "Abstract", shortName: "ABS", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 39_596_871n, identityDeploymentBlock: 39_596_871n },
  { chainId: 2046399126, name: "Skale Europa", shortName: "SKALE", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 1n },
  { chainId: 45056, name: "Billions", shortName: "BILLIONS", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 1n },
  { chainId: 1776, name: "Injective", shortName: "INJ", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 1n },
  { chainId: 4217, name: "Tempo", shortName: "TEMPO", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 1n },
  { chainId: 42, name: "LUKSO", shortName: "LYX", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 1n },
  { chainId: 10088, name: "Gate Layer Mainnet", shortName: "GATE", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 1n },
  { chainId: 360, name: "Shape", shortName: "SHAPE", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 1n },
  { chainId: 196, name: "X Layer", shortName: "XLAYER", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 1n },
  { chainId: 2345, name: "GOAT Network", shortName: "GOAT", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 1n },
  { chainId: 1088, name: "Metis", shortName: "METIS", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 1n },
  { chainId: 1187947933, name: "SKALE Base", shortName: "SKL-BASE", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 1n },
  { chainId: 1868, name: "Soneium", shortName: "SONEIUM", identityRegistry: IDENTITY, reputationRegistry: REPUTATION, validationRegistry: VALIDATION, deploymentSearchHint: 18_879_198n, identityDeploymentBlock: 18_879_198n },
  {
    chainId: ARC_TESTNET_CHAIN_ID,
    name: "Arc",
    shortName: "ARC",
    identityRegistry: TESTNET_IDENTITY,
    reputationRegistry: TESTNET_REPUTATION,
    validationRegistry: TESTNET_VALIDATION,
    deploymentSearchHint: 1n,
  },
  {
    chainId: SOLANA_CHAIN_ID,
    name: "Solana",
    shortName: "SOL",
    identityRegistry: SOLANA_AGENT_REGISTRY_PROGRAM,
    reputationRegistry: SOLANA_ATOM_ENGINE_PROGRAM,
    validationRegistry: "",
    deploymentSearchHint: 0n,
  },
];

export function getChainByChainId(chainId: number): ChainConfig | undefined {
  return CHAINS.find((chain) => chain.chainId === chainId);
}

export function assertCanonicalChainDescriptors(): void {
  const seen = new Set<number>();
  for (const chain of CHAINS) {
    if (!Number.isSafeInteger(chain.chainId) || chain.chainId <= 0) throw new Error(`invalid chain id ${chain.chainId}`);
    if (seen.has(chain.chainId)) throw new Error(`duplicate chain descriptor ${chain.chainId}`);
    seen.add(chain.chainId);
    if (chain.chainId === SOLANA_CHAIN_ID) continue;
    if (!isErc8004IndexingEnabled(chain)) {
      if (chain.identityRegistry || chain.reputationRegistry || chain.validationRegistry) {
        throw new Error(`disabled ERC-8004 chain ${chain.chainId} must not advertise undeployed registries`);
      }
      continue;
    }
    for (const [domain, address] of [
      ["identity", chain.identityRegistry],
      ["reputation", chain.reputationRegistry],
      ["validation", chain.validationRegistry],
    ] as const) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`invalid ${domain} registry for chain ${chain.chainId}`);
      const proven = provenRegistryDeploymentBlock(chain, domain);
      if (proven != null && proven < 0n) throw new Error(`invalid ${domain} deployment block for chain ${chain.chainId}`);
    }
    if (chain.deploymentSearchHint < 0n) throw new Error(`invalid deployment search hint for chain ${chain.chainId}`);
  }
}
