/** Normalized Hatcher agent status checks (hub stats + filters). */
export function isHatcherActiveStatus(status: string | undefined | null): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "active" || s === "running";
}
export function isHatcherSleepingStatus(status: string | undefined | null): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "sleeping" || s === "dormant";
}
