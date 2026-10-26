import type { CovenantCheckId, CovenantDetailPayload } from "@/lib/covenant/types";






export const covenantChecklistPublicLabels: Record<CovenantCheckId, string> = {
  identity_binding: "SAP identity binding",
  manifest_binding: "Manifest binding",
  audit_root_presence: "Audit root presence",
  signature_match: "Audit root signature",
  audit_root_recomputation: "Audit root recomputation",
};
/** Sidebar / partner card: never bare "Verified" unless full Covenant verification passed. */
export function covenantPartnerVerificationStatusLabel(covenant: CovenantDetailPayload): string {
  if (covenant.status === "verified") return "Covenant Verified";
  if (covenant.status === "verified_attested") return "Covenant Attested";
  if (covenant.status === "identity_only") return "Verification Pending";
  if (covenant.status === "indexed") return "Covenant Indexed";
  return "—";
}