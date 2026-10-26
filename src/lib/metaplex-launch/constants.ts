/** Metaplex Genesis token metadata limits (official SDK). */
export const METAPLEX_TOKEN_NAME_MAX = 32;
export const METAPLEX_TOKEN_SYMBOL_MAX = 10;
export const METAPLEX_TOKEN_DESCRIPTION_MAX = 250;
export const METAPLEX_IRYS_GATEWAY_PREFIX = "https://gateway.irys.xyz/";
/** Upfront Solana deposit for Irys + agent mint + Genesis (excludes optional first buy). */
export const METAPLEX_LAUNCH_DEPOSIT_LAMPORTS = 81_000_000;
export const METAPLEX_LAUNCH_REGISTRY_ID = "agentranking" as const;
export const METAPLEX_LAUNCH_ATTEMPT_STATUSES = [
  "DRAFT",
  "METADATA_READY",
  "AGENT_TRANSACTION_BUILT",
  "AGENT_SUBMITTED",
  "AGENT_CONFIRMED",
  "AGENT_REGISTERED",
  "GENESIS_PREPARED",
  "GENESIS_SUBMITTED",
  "GENESIS_ONCHAIN_CONFIRMED",
  "GENESIS_REGISTERED",
  "AR_INDEX_PENDING",
  "COMPLETE",
  "FAILED_RECOVERABLE",
  "FAILED_FINAL",
] as const;
export type MetaplexLaunchAttemptStatus = (typeof METAPLEX_LAUNCH_ATTEMPT_STATUSES)[number];
const METAPLEX_LAUNCH_ATTEMPT_STATUS_SET: ReadonlySet<string> = new Set(
  METAPLEX_LAUNCH_ATTEMPT_STATUSES,
);
export function parseMetaplexLaunchAttemptStatus(
  value: string,
): MetaplexLaunchAttemptStatus {
  if (METAPLEX_LAUNCH_ATTEMPT_STATUS_SET.has(value)) {
    return value as MetaplexLaunchAttemptStatus;
  }
  throw new Error(`Unknown Metaplex launch status: ${value}`);
}
export const METAPLEX_LAUNCH_RECOVERABLE_STATUSES: ReadonlySet<MetaplexLaunchAttemptStatus> =
  new Set([
    "DRAFT",
    "METADATA_READY",
    "AGENT_TRANSACTION_BUILT",
    "AGENT_SUBMITTED",
    "AGENT_CONFIRMED",
    "AGENT_REGISTERED",
    "GENESIS_PREPARED",
    "GENESIS_SUBMITTED",
    "GENESIS_ONCHAIN_CONFIRMED",
    "GENESIS_REGISTERED",
    "AR_INDEX_PENDING",
    "FAILED_RECOVERABLE",
  ]);
export const METAPLEX_LAUNCH_TERMINAL_STATUSES: ReadonlySet<MetaplexLaunchAttemptStatus> =
  new Set(["COMPLETE", "FAILED_FINAL"]);
