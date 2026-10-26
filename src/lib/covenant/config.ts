/** OpenCovenant uses the same Synapse SAP program as OOBE (no separate deploy). */
export const OPEN_COVENANT_SAP_PROGRAM_ID = "SAPpUhsWLJG1FfkGRcXagEDMrMsWGjbky7AyhGpFETZ";
export const COVENANT_RUNTIME_PROTOCOL = "covenant.runtime/v1";
export const COVENANT_AUDIT_ROOT_LABEL = "covenant.audit-root";
export const COVENANT_VERIFICATION_SNAPSHOT_KEY = "covenant_verification_snapshot";
export const COVENANT_VERIFICATION_CHECKED_AT_KEY = "covenant_verification_checked_at";
export const COVENANT_DETECTED_AT_KEY = "covenant_detected_at";
export const COVENANT_VERIFY_SPEC_VERSION = "covenant.opencovenant-verified.v0" as const;
/** Re-verify Covenant agents at most this often (background job). */
export const COVENANT_VERIFY_STALE_MS = 24 * 60 * 60 * 1000;
export function resolveOpenCovenantProgramId(): string {
  return (process.env.SAP_PROGRAM_ID ?? OPEN_COVENANT_SAP_PROGRAM_ID).trim();
}
/** Optional comma-separated audit hosts when files are not under agentUri (e.g. opencovenant.org). */
export function resolveCovenantAuditBaseUrlFallbacks(): string[] {
  const raw = process.env.COVENANT_AUDIT_BASE_URL?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}
