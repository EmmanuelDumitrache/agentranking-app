import { SOLANA_AGENT_REGISTRY_PROGRAM } from "../chain-constants";
export const SOLANA_REGISTRY_SOURCE = {
  SOLANA_8004: "solana-8004",
  METAPLEX_AGENT_REGISTRY: "metaplex-agent-registry",
} as const;
export const SOLANA_8004_IDENTITY_SOURCE_KEY = `solana:8004:identity:${SOLANA_AGENT_REGISTRY_PROGRAM}`;
export const SOLANA_8004_TRUST_SOURCE_KEY = `solana:8004:trust:${SOLANA_AGENT_REGISTRY_PROGRAM}`;
export const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;
export const POSTGRES_SIGNED_INT_MAX = 2_147_483_647;
export type SolanaRegistrySource =
  (typeof SOLANA_REGISTRY_SOURCE)[keyof typeof SOLANA_REGISTRY_SOURCE];
export type SnapshotDescriptor = {
  source: SolanaRegistrySource;
  registryAddress: string;
  generation: bigint;
  sourceSlot: bigint | null;
  reportedCount: number | null;
  inventoryCount?: number | null;
  inventoryDigest?: string | null;
  proofCount?: number;
  terminalRejectCount?: number;
  rpcEndpointKey?: string | null;
  genesisHash?: string | null;
  programId?: string | null;
  idlHash?: string | null;
  configurationFingerprint?: string | null;
  baseCollection?: string | null;
  rootConfigPda?: string | null;
  registryConfigPda?: string | null;
  inventoryStartSlot?: bigint | null;
  inventoryEndSlot?: bigint | null;
};
export type CurrentSolanaAgent = {
  source: SolanaRegistrySource;
  externalId: string;
  registryAddress: string;
  assetAddress: string;
  sequenceId: bigint | null;
  owner: string | null;
  creator: string | null;
  operationalWallet: string | null;
  registrationUri: string | null;
  sourceActive: boolean | null;
  sourceSlot: bigint | null;
  sourceUpdatedAt: Date | null;
  nameHint: string | null;
  /**
   * Exact length-prefixed identity for source evidence used by stable-snapshot
   * comparisons. Sources that cannot provide one may leave it null and use the
   * JSONB compatibility comparison in the membership writer.
   */
  sourceEvidenceKey: string | null;
  raw: Record<string, unknown>;
};
