import path from "node:path";

export const DEMO_SNAPSHOT_DIR = path.join(import.meta.dirname, "..", "..", "demo", "snapshot");

/** Insert order respects foreign keys (Chain before Agent before its children). */
export const DEMO_SNAPSHOT_TABLES = ["Chain", "Agent", "AgentMetadata", "AgentService", "DaoLeaderboardLive"];

/** Agents created inside AgentRanking belong to real accounts and are never exported. */
export const NATIVE_AGENTRANKING_CHAIN_ID = 990003;

/** Columns that tie an agent to an account, custodial wallet, referral, or internal diagnostics. */
export const AGENT_PRIVATE_COLUMN_RESETS = {
  owner_account_id: null,
  agent_wallet_id: null,
  agent_evm_wallet_id: null,
  evm_privy_wallet_id: null,
  evm_wallet_address: null,
  evm_wallet_status: "not_configured",
  public_referral_code: null,
  registration_error_message: null,
  ar_verification_wallet: null,
};

export const DAO_LEADERBOARD_PRIVATE_COLUMN_RESETS = {
  notes: "",
};
