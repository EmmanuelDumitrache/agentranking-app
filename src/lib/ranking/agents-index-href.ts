export type AgentsIndexHrefInput = {
  readonly query: string;
  readonly chainId: number | null;
  readonly verifiedOnly: boolean;
  readonly x402Only: boolean;
  readonly mppOnly: boolean;
};

export function buildAgentsIndexHref(
  input: AgentsIndexHrefInput,
  pagination?: { readonly after?: string | null; readonly before?: string | null },
): string {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.chainId != null) params.set("chain", String(input.chainId));
  if (input.verifiedOnly) params.set("verified", "1");
  if (input.x402Only) params.set("x402", "1");
  if (input.mppOnly) params.set("mpp", "1");
  if (pagination?.before) params.set("before", pagination.before);
  else if (pagination?.after) params.set("after", pagination.after);
  const query = params.toString();
  return query ? `/agents?${query}` : "/agents";
}
