import {
  METAPLEX_LAUNCH_RECOVERABLE_STATUSES,
  METAPLEX_LAUNCH_TERMINAL_STATUSES,
  type MetaplexLaunchAttemptStatus,
} from "@/lib/metaplex-launch/constants";

const ORDERED: readonly MetaplexLaunchAttemptStatus[] = [
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
] as const;

const STATUS_INDEX = new Map(ORDERED.map((s, i) => [s, i]));

export function isMetaplexLaunchRecoverable(status: MetaplexLaunchAttemptStatus): boolean {
  return METAPLEX_LAUNCH_RECOVERABLE_STATUSES.has(status);
}

export function isMetaplexLaunchTerminal(status: MetaplexLaunchAttemptStatus): boolean {
  return METAPLEX_LAUNCH_TERMINAL_STATUSES.has(status);
}

export function canAdvanceMetaplexLaunchStatus(
  from: MetaplexLaunchAttemptStatus,
  to: MetaplexLaunchAttemptStatus,
): boolean {
  if (from === to) return true;
  if (isMetaplexLaunchTerminal(from)) return false;
  if (to === "FAILED_RECOVERABLE" || to === "FAILED_FINAL") return true;
  const fromIdx = STATUS_INDEX.get(from);
  const toIdx = STATUS_INDEX.get(to);
  if (fromIdx == null || toIdx == null) return false;
  return toIdx === fromIdx + 1;
}

export function assertMetaplexLaunchStatusAdvance(
  from: MetaplexLaunchAttemptStatus,
  to: MetaplexLaunchAttemptStatus,
): void {
  if (!canAdvanceMetaplexLaunchStatus(from, to)) {
    throw new Error(`Invalid Metaplex launch status transition: ${from} → ${to}`);
  }
}

export function metaplexLaunchStatusLabel(status: MetaplexLaunchAttemptStatus): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "METADATA_READY":
      return "Metadata ready";
    case "AGENT_TRANSACTION_BUILT":
      return "Agent transaction built";
    case "AGENT_SUBMITTED":
      return "Agent submitted";
    case "AGENT_CONFIRMED":
      return "Agent confirmed";
    case "AGENT_REGISTERED":
      return "Agent registered";
    case "GENESIS_PREPARED":
      return "Genesis prepared";
    case "GENESIS_SUBMITTED":
      return "Genesis submitted";
    case "GENESIS_ONCHAIN_CONFIRMED":
      return "Genesis on-chain";
    case "GENESIS_REGISTERED":
      return "Genesis registered";
    case "AR_INDEX_PENDING":
      return "Indexing";
    case "COMPLETE":
      return "Complete";
    case "FAILED_RECOVERABLE":
      return "Failed (recoverable)";
    case "FAILED_FINAL":
      return "Failed";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
