/**
 * Detect placeholder / bulk-mint listings (e.g. "Agent #12345" with no description and no real endpoints).
 * On-chain JSON often uses `services: [{}]` which becomes non-empty rows but no usable endpoint.
 */
export function hasSubstantiveServiceEndpoints(
  services: readonly { endpoint?: string | null }[],
): boolean {
  return services.some((s) => (s.endpoint ?? "").trim().length > 0);
}
export function isLowSignalAgentListing(
  name: string,
  description: string,
  services: readonly { endpoint?: string | null }[],
): boolean {
  const n = name.trim();
  const d = description.trim();
  const badName =
    !n ||
    n.toLowerCase() === "unnamed agent" ||
    /^Agent #\d+$/i.test(n);
  return badName && !d && !hasSubstantiveServiceEndpoints(services);
}