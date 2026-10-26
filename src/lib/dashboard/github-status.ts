/** GitHub connection statuses that mean the repo is linked and healthy in dashboard UI. */
export function isGithubConnectionHealthy(status: string | null | undefined): boolean {
  const s = status?.trim().toLowerCase();
  return s === "active" || s === "connected";
}
export function formatGithubConnectionStatus(status: string | null | undefined): string {
  const s = status?.trim().toLowerCase();
  if (s === "active" || s === "connected") return "Active";
  if (s === "pending") return "Pending";
  if (!s) return "Not connected";
  return status!.charAt(0).toUpperCase() + status!.slice(1);
}
