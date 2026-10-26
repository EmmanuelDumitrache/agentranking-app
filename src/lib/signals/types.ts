export const SIGNAL_STATUSES = [
  "detected",
  "submitted",
  "verified",
  "failed",
  "stale",
  "partner_registered",
  "disabled",
  "unknown",
] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];
export const SIGNAL_SOURCES = [
  "user_submission",
  "wallet_signature",
  "github_app",
  "github_oauth",
  "x_oauth",
  "domain_check",
  "endpoint_check",
  "protocol_index",
  "sap",
  "mcp",
  "x402",
  "admin",
  "orbit",
] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];
export const SIGNAL_TYPES = [
  "wallet_verified",
  "x_verified",
  "github_verified",
  "domain_verified",
  "official_links_locked",
  "repo_connected",
  "devproof_active",
  "endpoint_live",
  "endpoint_failing",
  "mcp_detected",
  "mcp_verified",
  "a2a_detected",
  "x402_detected",
  "x402_payable",
  "payment_wallet_verified",
  "sap_registered",
  "partner_registered",
  "orbit_launch_verified",
  "token_verified",
  "claimed_by_team",
  "agentranking_verified",
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];
export type DerivedSignal = {
  signalType: SignalType;
  status: SignalStatus;
  source: SignalSource;
  confidence: "low" | "medium" | "high";
  value?: string;
  payloadJson?: Record<string, unknown>;
  evidenceUrl?: string;
  verifiedAt?: Date | null;
  lastCheckedAt?: Date | null;
  expiresAt?: Date | null;
};
export type TrustSummaryTile = {
  key: string;
  label: string;
  value: string;
  status: SignalStatus;
  /** When set, shown under value instead of raw signal status (e.g. Medusa tier · use case). */
  statusLabel?: string;
  title?: string;
};