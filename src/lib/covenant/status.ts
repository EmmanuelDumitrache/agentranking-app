import type {
  CovenantCheckId,
  CovenantCheckState,
  CovenantStatus,
  CovenantVerificationSnapshot,
} from "@/lib/covenant/types";
const ALL_CHECKS: CovenantCheckId[] = [
  "identity_binding",
  "manifest_binding",
  "audit_root_presence",
  "signature_match",
  "audit_root_recomputation",
];
export function emptyChecks(): Record<CovenantCheckId, CovenantCheckState> {
  return {
    identity_binding: "pending",
    manifest_binding: "pending",
    audit_root_presence: "pending",
    signature_match: "pending",
    audit_root_recomputation: "pending",
  };
}
export function deriveCovenantStatus(
  isCovenant: boolean,
  checks: Record<CovenantCheckId, CovenantCheckState>,
  rootSource?: "self" | "sigstore",
): CovenantStatus {
  if (!isCovenant) return "not_covenant";
  const pass = (id: CovenantCheckId) => checks[id] === "pass";
  if (ALL_CHECKS.every(pass)) {
    if (rootSource === "sigstore") return "verified_attested";
    return "verified";
  }
  if (pass("identity_binding") && pass("manifest_binding")) {
    return "identity_only";
  }
  return "indexed";
}
export function isFullCovenantVerifiedStatus(status: CovenantStatus): boolean {
  return status === "verified" || status === "verified_attested";
}
export function snapshotToChecks(
  snapshot: CovenantVerificationSnapshot | null,
): Record<CovenantCheckId, CovenantCheckState> {
  if (!snapshot?.checks) return emptyChecks();
  return { ...emptyChecks(), ...snapshot.checks };
}