
export const ADMIN_TOKEN_VERIFICATION_OPTIONS = [
  { value: "verified", label: "Verified" },
  { value: "unverified", label: "Unverified" },
] as const;
export type AdminTokenVerificationChoice = (typeof ADMIN_TOKEN_VERIFICATION_OPTIONS)[number]["value"];
export function isArTokenVerified(status: string | null | undefined): boolean {
  return status === "verified";
}
/** Map DB status to admin dropdown (verified vs everything else). */
export function toAdminTokenVerificationChoice(status: string | null | undefined): AdminTokenVerificationChoice {
  return isArTokenVerified(status) ? "verified" : "unverified";
}