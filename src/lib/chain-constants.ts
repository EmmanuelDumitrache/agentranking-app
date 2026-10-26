/**
 * Synthetic chain id for Solana in shared URLs and DB (`Agent.chainId` / `Chain.chainId`).
 * Must match `src/worker/indexer/chain-constants.ts` — Solana is not an EVM chain id.
 */
export const SOLANA_CHAIN_ID = 900_001;
/** Synthetic chain id for Hatcher partner-indexed agents (not on-chain). */
export const HATCHER_CHAIN_ID = 990_002;
/** Synthetic chain id for AgentRanking-native agents (dashboard create flow). */
export const AGENTRANKING_NATIVE_CHAIN_ID = 990_003;
/** Circle Arc testnet — ERC-8004 identity lives here until Arc mainnet (5042) is public. */
export const ARC_TESTNET_CHAIN_ID = 5_042_002;
export const SOLANA_AGENT_REGISTRY_PROGRAM = "8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ";
export const SOLANA_ATOM_ENGINE_PROGRAM = "AToMw53aiPQ8j7iHVb4fGt6nzUNxUhcPc3tbPBZuzVVb";
