export type SolanaRpcErrorLike = {
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  cause?: unknown;
  errors?: unknown;
};

function errorChain(error: unknown): SolanaRpcErrorLike[] {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  const nodes: SolanaRpcErrorLike[] = [];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const node = current as SolanaRpcErrorLike;
    nodes.push(node);
    if (node.cause != null) pending.push(node.cause);
    if (Array.isArray(node.errors)) pending.push(...node.errors);
  }
  return nodes;
}

/** Detect provider quota/rate-limit failures without depending on one Solana SDK error class. */
export function isSolanaRpcRateLimitError(error: unknown): boolean {
  const nodes = errorChain(error);
  for (const node of nodes) {
    if (node.status === 429 || node.statusCode === 429 || node.code === 429) {
      return true;
    }
  }
  const message = nodes
    .flatMap((node) => [node.message, node.shortMessage, node.details])
    .filter((value): value is string => typeof value === "string")
    .join(" | ")
    .toLowerCase();
  return /\b429\b|too many requests?|rate.?limit|quota|capacity limit|max(?:imum)? usage (?:reached|exceeded)|usage limit (?:reached|exceeded)|max usage reached/.test(
    message,
  );
}
