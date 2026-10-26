/** OpenCovenant verification check ids (verified-spec v0). */
export type CovenantCheckId =
  | "identity_binding"
  | "manifest_binding"
  | "audit_root_presence"
  | "signature_match"
  | "audit_root_recomputation";
export type CovenantCheckState = "pass" | "fail" | "pending";
export type CovenantStatus =
  | "not_covenant"
  | "indexed"
  | "identity_only"
  | "verified"
  | "verified_attested";
export type CovenantRootSource = "self" | "sigstore";
/** Cached in AgentMetadata (`covenant_verification_snapshot`). */
export type CovenantVerificationSnapshot = {
  specVersion: "covenant.opencovenant-verified.v0";
  checkedAt: string;
  checks: Record<CovenantCheckId, CovenantCheckState>;
  missingChecks: CovenantCheckId[];
  reasons: string[];
  rootHashHex?: string;
  rootSignedBy?: string;
  rootSignedAt?: string;
  rootSource?: CovenantRootSource;
  releaseTarget?: string | null;
};
/** Public agent detail payload. */
export type CovenantDetailPayload = {
  isCovenant: boolean;
  status: CovenantStatus;
  protocolVersion?: string;
  rootHashHex?: string;
  rootSignedBy?: string;
  rootSignedAt?: string;
  rootCheckedAt?: string;
  rootSource?: CovenantRootSource;
  releaseTarget?: string | null;
  reasons: string[];
  missingChecks: string[];
  checks: Record<CovenantCheckId, CovenantCheckState>;
};
export type CovenantAgentRowInput = {
  sapProtocols?: string[] | null;
  sapAgentPda?: string | null;
  sapOwnerWallet?: string | null;
  sapCapabilities?: unknown;
  agentURI?: string | null;
  isActive?: boolean;
  metadata?: Array<{ key: string; value: string }>;
};