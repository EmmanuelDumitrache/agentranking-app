export const SOLANA_8004_MAINNET_PROGRAM_ID = "8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ";
export const SOLANA_MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const MPL_CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
export const SOLANA_8004_PROTOCOL_IMPLEMENTATION = "quantu-agent-registry-8004";
export const SOLANA_8004_PINNED_IDL_SHA256 = "86e896e891b6c23ec72727c8c6008a2beb7d1a70a9a6708c66902f58b82e9656";
export const SOLANA_8004_AGENT_SEED = Buffer.from("agent", "utf8");
export const SOLANA_8004_ROOT_CONFIG_SEED = Buffer.from("root_config", "utf8");
export const SOLANA_8004_REGISTRY_CONFIG_SEED = Buffer.from("registry_config", "utf8");
export const SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR = Uint8Array.from([241, 119, 69, 140, 233, 9, 112, 50]);
export const SOLANA_8004_ROOT_CONFIG_DISCRIMINATOR = Uint8Array.from([42, 216, 8, 82, 19, 209, 223, 246]);
export const SOLANA_8004_REGISTRY_CONFIG_DISCRIMINATOR = Uint8Array.from([23, 118, 10, 246, 173, 231, 243, 156]);
export const SOLANA_8004_MAX_AGENT_URI_BYTES = 250;
export const SOLANA_8004_MAX_NFT_NAME_BYTES = 32;
export const SOLANA_8004_MAX_COLLECTION_POINTER_BYTES = 128;
export const SOLANA_RPC_ACCOUNT_BATCH_SIZE = 100;
// Account hydration is independent by RPC page. A small bounded fan-out keeps
// 100k-account snapshots from serializing a thousand network round trips while
// the endpoint scheduler and distributed budgets retain the authoritative cap.
export const SOLANA_RPC_ACCOUNT_BATCH_CONCURRENCY = 4;
export const SOLANA_8004_INVENTORY_DATA_SLICE_BYTES = 8;
