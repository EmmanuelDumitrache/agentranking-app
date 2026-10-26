export type RpcErrorClass =
  | "range_limit"
  | "response_size_limit"
  | "provider_lag"
  | "unknown_block"
  | "noncanonical_block"
  | "pruned_history"
  | "unsupported_tag"
  | "method_not_found"
  | "method_restricted"
  | "invalid_parameter"
  | "rate_limit"
  | "authentication"
  | "transport_failure"
  | "contract_revert"
  | "contract_decode"
  | "chain_mismatch"
  | "provider_retired"
  | "unknown";
type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  details?: unknown;
  shortMessage?: unknown;
  cause?: unknown;
  errors?: unknown;
};
function chain(error: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  let pendingIndex = 0;
  while (pendingIndex < pending.length) {
    const current = pending[pendingIndex++];
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const node = current as ErrorLike;
    out.push(node);
    if (node.cause != null) pending.push(node.cause);
    if (Array.isArray(node.errors)) pending.push(...node.errors);
  }
  return out;
}
function text(nodes: ErrorLike[]): string {
  return nodes.flatMap((node) => [node.name, node.message, node.shortMessage, node.details])
    .filter((value): value is string => typeof value === "string")
    .join(" | ")
    .toLowerCase();
}
function numeric(nodes: ErrorLike[], key: "code" | "status" | "statusCode"): number[] {
  return nodes.map((node) => node[key]).map((value) => typeof value === "number" ? value : Number.NaN).filter(Number.isFinite);
}
function stringCodes(nodes: ErrorLike[]): string[] {
  return nodes.map((node) => node.code).filter((value): value is string => typeof value === "string").map((value) => value.toUpperCase());
}
type RpcRequestDiagnostic = { method: string; params: unknown[] };
function rpcRequestDiagnostic(nodes: ErrorLike[]): RpcRequestDiagnostic | null {
  const values = nodes.flatMap((node) => [node.message, node.shortMessage, node.details])
    .filter((value): value is string => typeof value === "string");
  for (const value of values) {
    const match = /request body:\s*(\{[\s\S]*?\})(?=\s*(?:details:|version:|$))/i.exec(value);
    if (match?.[1]) {
      try {
        const parsed = JSON.parse(match[1]) as { method?: unknown; params?: unknown };
        if (typeof parsed.method === "string" && Array.isArray(parsed.params)) {
          return { method: parsed.method.toLowerCase(), params: parsed.params };
        }
      } catch {
        // Fall through to the bounded regex extraction below.
      }
    }
    const method = /["']method["']\s*:\s*["']([a-z0-9_]+)["']/i.exec(value)?.[1];
    if (method) return { method: method.toLowerCase(), params: [] };
  }
  return null;
}
function isHistoricalBlockSelector(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "latest" || normalized === "pending") return false;
  return /^(?:0x[0-9a-f]+|[0-9]+)$/.test(normalized);
}
function requestNeedsHistoricalState(request: RpcRequestDiagnostic | null): boolean {
  if (!request) return false;
  const { method, params } = request;
  if (["eth_getcode", "eth_getbalance", "eth_gettransactioncount", "eth_call"].includes(method)) {
    return isHistoricalBlockSelector(params[1]);
  }
  if (method === "eth_getstorageat") return isHistoricalBlockSelector(params[2]);
  if (method === "eth_getblockbynumber") return isHistoricalBlockSelector(params[0]);
  if (method === "eth_getlogs") {
    const filter = params[0];
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) return false;
    const row = filter as { fromBlock?: unknown; toBlock?: unknown; blockHash?: unknown };
    return Boolean(row.blockHash) || isHistoricalBlockSelector(row.fromBlock) || isHistoricalBlockSelector(row.toBlock);
  }
  return false;
}
/** Classify typed transport/RPC behavior before using narrow message fallbacks. */
export function classifyRpcError(error: unknown): RpcErrorClass {
  const nodes = chain(error);
  const names = nodes.map((node) => String(node.name ?? ""));
  const codes = numeric(nodes, "code");
  const statuses = [...numeric(nodes, "status"), ...numeric(nodes, "statusCode")];
  const symbolicCodes = stringCodes(nodes);
  const message = text(nodes);
  const requestDiagnostic = rpcRequestDiagnostic(nodes);
  const historicalRequest = requestNeedsHistoricalState(requestDiagnostic);
  // Retired public gateways often return a JSON-RPC-shaped invalid-input error rather than
  // an HTTP 404/410. Detect this before viem's generic InvalidInput/InvalidParams classes so
  // the endpoint is disabled permanently and the operation can continue through the pool.
  if (/(?:api|rpc|service|endpoint|gateway)[^|]*(?:is|has been) no longer available|(?:service|endpoint|gateway)[^|]*(?:retired|discontinued|shut down|decommissioned)|please update your integration[^|]*(?:instead|use)|migrat(?:e|ed|ing)[^|]*(?:api|rpc|provider)|no proxy rule for this subdomain/.test(message)) return "provider_retired";
  // JSON-RPC is POSTed to a fixed endpoint. HTTP 404/410 therefore means the
  // configured gateway/path itself no longer serves RPC, not that an individual
  // chain object was absent. Treat it as a permanently retired endpoint so one
  // stale public URL cannot abort the logical operation before pool fallback.
  if (
    statuses.some((status) => status === 404 || status === 410)
    || /(?:status:\s*)?(?:404|410)[^|]*(?:default backend|not found|gone)/.test(message)
  ) return "provider_retired";
  // A provider may use HTTP 401/403 for historical access while still serving current-state
  // requests publicly. Classify the narrower archive capability before generic auth status.
  if (/archive requests? require|historical (?:logs?|blocks?|requests?)[^|]*(?:token|key|archive)|requires? (?:an? )?(?:archive|personal) (?:node|token|key)/.test(message)) return "pruned_history";
  if (/(?:block with such an id is pruned|first retained block|earliest retained block|oldest (?:available|retained) block|history (?:has been|is) pruned|pruned history unavailable|upstream lower height [0-9]+ of type (?:receipts|blocks?|state)[^|]*greater than|requested (?:block|height)[^|]*(?:below|before) (?:the )?(?:first|earliest|oldest) (?:available|retained)|missing trie node|historical state|archive node|state is not available|no state available for block)/.test(message)) return "pruned_history";
  // Archive gateways also surface capability misses as generic internal/invalid-input
  // errors. Use the historical request diagnostic before generic -32603/-32602
  // handling so the pool disables archive routing for this endpoint and fails over.
  if (
    historicalRequest
    && /no archival-capable endpoints? available for archival request|archival-capable endpoints? unavailable|state recreation(?: l2)?(?: gas)? depth limit exceeded/.test(message)
  ) return "pruned_history";
  if (statuses.includes(429)) return "rate_limit";
  // Providers frequently reuse JSON-RPC limit codes such as -32005 for both
  // throughput quotas and eth_getLogs span/result limits. Prefer the explicit
  // request-specific diagnostic before interpreting the generic numeric code.
  if (
    requestDiagnostic?.method === "eth_getlogs"
    && /(?:log response size exceeded[^|]*maximum allowed number of requested blocks|maximum allowed number of requested blocks|requested blocks (?:is|are) limited to|request (?:is )?too (?:complex|large)|too complex\/large|try lesser input)/.test(message)
  ) return "range_limit";
  if (codes.includes(-32005) || codes.includes(-32016)) return "rate_limit";
  // Some gateways report a method-level plan restriction with HTTP 401/402/403. Preserve the
  // narrower capability classification so the endpoint remains usable for unrestricted methods.
  if (/(?:method|feature)[^|]*(?:available|enabled|supported)[^|]*paid plans? only|upgrade (?:your )?(?:plan|subscription)[^|]*(?:access|enable|use)|requires? (?:a )?paid (?:plan|subscription|tier)/.test(message)) return "method_restricted";
  if (statuses.some((status) => status === 401 || status === 402 || status === 403)) return "authentication";
  // Several public gateways wrap missing method support in InvalidInputRpcError/-32602.
  // Inspect the provider detail before viem's generic invalid-parameter class.
  if (/(?:details:\s*)?method (?:is )?(?:not available|unavailable|disabled)|(?:rpc )?method[^|]*(?:not available|unavailable|disabled)/.test(message)) return "method_not_found";
  if (/eth_getlogs[^|]*(?:details:\s*)?not found|(?:details:\s*)?not found[^|]*eth_getlogs/.test(message)) return "method_not_found";
  if (codes.includes(-32601) || names.includes("MethodNotFoundRpcError")) return "method_not_found";
  if (
    codes.includes(-32603) ||
    /method handler crashed|handler (?:has )?crashed|internal (?:json-?rpc|rpc|server) error|internal error:\s*hedge race response failed heuristic check|hedge race response failed heuristic check|upstream (?:rpc )?(?:failed|error)|no healthy upstream available/.test(message)
  ) return "transport_failure";
  if (
    /(?:request body|method)[^|]*eth_chainid[^|]*(?:unknown|unsupported|invalid) network|(?:unknown|unsupported|invalid) network[^|]*(?:request body|method)[^|]*eth_chainid/.test(message)
  ) return "chain_mismatch";
  // Historical-state gateways frequently report an absent archive record as generic invalid
  // input. Treat this as a per-endpoint archive capability result rather than a caller bug.
  if (/(?:request body|method)[^|]*eth_getcode[^|]*metadata is not found|metadata is not found[^|]*(?:request body|method)[^|]*eth_getcode/.test(message)) return "pruned_history";
  // Public catalog endpoints may return a JSON-RPC-shaped InvalidInput error while temporarily
  // unavailable. This is a transport/provider-health failure and should fall through the pool.
  if (/temporary(?:ily)? (?:is )?not available|temporarily unavailable|service temporarily unavailable/.test(message)) return "transport_failure";
  // Public gateways often wrap archive misses and unsupported historical methods in
  // InvalidInputRpcError/-32602. Use the diagnostic request body to distinguish a
  // provider capability problem from a malformed caller parameter.
  if (historicalRequest && /header not found|no state (?:found|available) for block|historical (?:state|block)|archive[^|]*(?:required|unsupported|unavailable)|(?:details:\s*)?not supported/.test(message)) {
    return "pruned_history";
  }
  if (requestDiagnostic && /(?:details:\s*)?not supported|method (?:is )?unsupported/.test(message)) {
    return "method_not_found";
  }
  // Some clients surface capability and range limits as -32602/InvalidParams.
  // Inspect the actual RPC detail before collapsing those errors into the generic class.
  if (/(?:params?[^|]*["'](?:safe|finalized)["']|(?:safe|finalized) block (?:tag )?(?:is )?(?:unsupported|not found|unavailable)|unsupported[^|]*(?:safe|finalized)|unsupported block tag)/.test(message)) return "unsupported_tag";
  if (/response.*(?:too large|size|limit)|payload.*too large|more than .* results/.test(message)) return "response_size_limit";
  if (
    requestDiagnostic?.method === "eth_getlogs"
    && /request (?:is )?too (?:complex|large)|too complex\/large|try lesser input/.test(message)
  ) return "range_limit";
  if (/query returned more than|eth_getlogs[^|]*(?:limited|range)|block range|range .* too (?:large|wide)|maximum block range|requested too many blocks|exceeds? .* block/.test(message)) return "range_limit";
  if (/429|too many requests?|request too fast(?: per second)?|rate.?limit|quota|capacity limit|cu limit exceeded|(?:max(?:imum)? )?usage (?:limit )?(?:reached|exceeded)|reached (?:the|your) usage limit|usage limit for (?:the|your) current plan/.test(message)) return "rate_limit";
  if (/unauthori[sz]ed|forbidden|api key|payment required|subscription (?:is )?(?:disabled|required)/.test(message)) return "authentication";
  if (codes.includes(-32602) || names.some((name) => name === "InvalidParamsRpcError" || name === "InvalidInputRpcError")) return "invalid_parameter";
  if (names.some((name) => name === "BlockNotFoundError" || name === "BlockNumberNotFoundError")) return "unknown_block";
  if (names.some((name) => name === "ContractFunctionRevertedError" || name === "ContractFunctionExecutionError" || name === "CallExecutionError")) return "contract_revert";
  if (names.some((name) => name === "AbiDecodingDataSizeTooSmallError" || name === "AbiDecodingZeroDataError" || name === "DecodeLogDataMismatch" || name === "DecodeLogTopicsMismatch")) return "contract_decode";
  if (symbolicCodes.some((code) => ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"].includes(code))) return "transport_failure";
  if (names.some((name) => name === "TimeoutError" || name === "HttpRequestError" || name === "WebSocketRequestError" || name === "SocketError")) {
    if (statuses.some((status) => status >= 500)) return "transport_failure";
    if (message.includes("timeout") || message.includes("socket") || message.includes("fetch failed")) return "transport_failure";
  }
  if (/not canonical|noncanonical|canonical block.*(?:rejected|required)|block .* is not canonical/.test(message)) return "noncanonical_block";
  if (/header not found|unknown block|block (?:could )?not be found|cannot find block/.test(message)) return "unknown_block";
  if (/missing trie node|historical state|archive node|pruned|state is not available|no state available for block/.test(message)) return "pruned_history";
  if (/unsupported.*(?:safe|finalized)|unsupported block tag/.test(message)) return "unsupported_tag";
  if (/method not supported|method not found/.test(message)) return "method_not_found";
  if (/behind|not yet indexed|requested block .* future|block height .* latest|minimum context slot has not been reached/.test(message)) return "provider_lag";
  if (/invalid params?|invalid argument|invalid quantity/.test(message)) return "invalid_parameter";
  if (/execution reverted|contract function reverted|revert reason/.test(message)) return "contract_revert";
  if (/abi|decode|data size|topic count|contract function returned/.test(message)) return "contract_decode";
  if (/chain.?id mismatch|wrong chain/.test(message)) return "chain_mismatch";
  if (/429|too many requests?|request too fast(?: per second)?|rate.?limit|quota|capacity limit|cu limit exceeded|(?:max(?:imum)? )?usage (?:limit )?(?:reached|exceeded)|reached (?:the|your) usage limit|usage limit for (?:the|your) current plan/.test(message)) return "rate_limit";
  if (/unauthori[sz]ed|forbidden|api key|payment required/.test(message)) return "authentication";
  if (/timeout|timed out|etimedout|econnreset|econnrefused|socket hang up|fetch failed|502|503|504|525|bad gateway|service unavailable|gateway timeout|invalid json rpc response|unexpected token ['"]?|unexpected end of json(?: input)?|unterminated json/.test(message) || /<!doctype|is not valid json|returned no result|no (?:healthy|available) upstreams?|cancelled before execution|canceled before execution|temporar/.test(message)) return "transport_failure";
  return "unknown";
}
/** Extract an advertised eth_getLogs block-span cap from provider error text. */
export function rpcLogRangeLimit(error: unknown): number | null {
  const message = text(chain(error));
  const patterns = [
    /maximum allowed number of requested blocks (?:is|=|:)\s*([0-9][0-9,_]*)/,
    /(?:eth_getlogs[^|]*?)?limited to (?:a )?([0-9][0-9,_]*) (?:block )?range/,
    /block range (?:greater than|exceeds?|over) ([0-9][0-9,_]*)/,
    /(?:maximum|max) (?:allowed )?(?:block )?range(?: is| of|:)? ([0-9][0-9,_]*)/,
    /maximum (?:is )?set to ([0-9][0-9,_]*)/,
    /(?:up to|at most) ([0-9][0-9,_]*) blocks?/,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.[1]) continue;
    const parsed = Number(match[1].replace(/[,_]/g, ""));
    if (Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 10_000_000) return parsed;
  }
  return null;
}
/** Select a strictly smaller retry span, honoring a provider-advertised cap when present. */
export function reducedRpcLogRange(error: unknown, current: number): number {
  const boundedCurrent = Number.isSafeInteger(current) && current > 0 ? current : 1;
  const advertised = rpcLogRangeLimit(error);
  const halved = Math.max(1, Math.floor(boundedCurrent / 2));
  if (advertised == null) return halved;
  return Math.max(1, Math.min(boundedCurrent > 1 ? boundedCurrent - 1 : 1, advertised));
}
