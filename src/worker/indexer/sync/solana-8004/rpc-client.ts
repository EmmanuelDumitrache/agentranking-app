import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { deadlineSignal, throwIfAborted } from "../../lib/abort.js";
import { classifyRpcError, type RpcErrorClass } from "../../lib/rpc-error-classification.js";
import { getInfuraSolanaRpcUrls, redactRpcUrl } from "../rpc.js";
import { PUBLIC_SOLANA_RPC_PROVIDERS } from "../public-rpc-providers.js";
import { readBoundedJsonBody } from "@/lib/bounded-http-body";
import { getOrCreateResourceScheduler, type ResourceScheduler } from "../../resources/resource-scheduler.js";
import { createResourceProfile } from "../../resources/resource-profile.js";
import { solanaRpcResourceKey } from "../../resources/resource-key.js";
import type { Solana8004ProgramDefinition } from "./program.js";
import type { Solana8004RawTransaction } from "./trust-types.js";
import { DistributedWeightedRateBudget } from "../../resources/distributed-rate-budget.js";
import { mapWithConcurrency } from "@/lib/async-pool";

export const SolanaRpcAccountSchema = z.object({
  data: z.tuple([z.string(), z.literal("base64")]),
  executable: z.boolean(),
  lamports: z.number().int().nonnegative(),
  owner: z.string(),
  rentEpoch: z.number().optional(),
  space: z.number().optional(),
});

export type SolanaRpcAccount = z.infer<typeof SolanaRpcAccountSchema>;

export type Solana8004RpcEndpoint = {
  url: string;
  endpointKey: string;
  credentialKey: string;
  resourceKey: string;
  providerName: string;
  selectionWeight: number;
  genesisHash: string;
  validationSlot: bigint;
  firstAvailableBlock: bigint;
  minimumLedgerSlot: bigint;
  scheduler: ResourceScheduler;
  cooldownUntil: number;
  failureCount: number;
  selectionCount: number;
  inFlight: number;
  latencyEwmaMs: number;
};

const RpcEnvelopeSchema = z.object({
  jsonrpc: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    data: z.unknown().optional(),
  }).optional(),
});
type ProviderDefinition = { url: string; provider: string; weight: number };
const schedulers = new Map<string, ResourceScheduler>();
const weightedBudgets = new Map<string, DistributedWeightedRateBudget>();
const requestBudgets = new Map<string, DistributedWeightedRateBudget>();
let configuredProviderCache: { values: ProviderDefinition[]; fingerprint: string } | null = null;
let rpcId = 0;
let endpointCache: { key: string; expiresAt: number; promise: Promise<Solana8004RpcEndpoint[]> } | null = null;
const currentEndpointFallbacks = new WeakMap<Solana8004RpcEndpoint, readonly Solana8004RpcEndpoint[]>();
const ENDPOINT_CACHE_TTL_MS = 5 * 60_000;
const ENDPOINT_PROBE_CONCURRENCY = 4;
function rpcWeight(method: string, params: unknown[]): number {
  if (method === "getProgramAccounts") return 16;
  if (method === "getMultipleAccounts") {
    const addresses = Array.isArray(params[0]) ? params[0].length : 1;
    return Math.min(16, Math.max(2, Math.ceil(addresses / 16)));
  }
  if (method === "getTransaction") return 4;
  return 1;
}
function configuredProviders(): ProviderDefinition[] {
  if (configuredProviderCache) return configuredProviderCache.values;
  const explicit = [
    ...(config.solana8004RpcUrls ?? "").split(/[\s,]+/),
    ...(process.env.SOLANA_RPC_URLS ?? "").split(/[\s,]+/),
    process.env.SOLANA_RPC_URL ?? "",
    process.env.SOLANA_RPC_FALLBACK_URL ?? "",
    process.env.SOLANA_MAINNET_RPC_URL ?? "",
    process.env.HELIUS_RPC_URL ?? "",
  ].map((value) => value.trim()).filter(Boolean).map((url) => ({ url, provider: "operator-configured", weight: 10 }));
  const infura = getInfuraSolanaRpcUrls().map((url) => ({ url, provider: "Infura", weight: 8 }));
  const publicProviders = config.publicRpcProvidersEnabled
    ? PUBLIC_SOLANA_RPC_PROVIDERS.map((value) => ({ url: value.url, provider: value.provider, weight: value.weight }))
    : [];
  const seen = new Set<string>();
  const values = [...explicit, ...infura, ...publicProviders].flatMap((value) => {
    try {
      const url = new URL(value.url).toString().replace(/\/$/, "");
      if (seen.has(url)) return [];
      seen.add(url);
      return [{ ...value, url }];
    } catch {
      return [];
    }
  });
  configuredProviderCache = {
    values,
    fingerprint: createHash("sha256").update(JSON.stringify(values)).digest("hex"),
  };
  return values;
}
function credentialIdentity(raw: string): string {
  const url = new URL(raw);
  const path = url.pathname.split("/").filter(Boolean);
  const last = path.at(-1) ?? "";
  if (url.hostname.includes("infura.io") && last) return `infura:${last}`;
  if (url.hostname.includes("helius-rpc.com")) return `helius:${url.searchParams.get("api-key") ?? last}`;
  if (url.hostname.endsWith(".quiknode.pro")) return `quicknode:${url.hostname.split(".")[0]}`;
  const secrets = [...url.searchParams.entries()].filter(([key]) => /key|token|secret|auth|project/i.test(key)).sort();
  if (url.username || url.password || secrets.length > 0) {
    return `credential:${url.origin}:${JSON.stringify({ username: url.username, password: url.password, secrets })}`;
  }
  return `origin:${url.origin}`;
}
function schedulerFor(url: string): ResourceScheduler {
  const identity = credentialIdentity(url);
  const existing = schedulers.get(identity);
  if (existing) return existing;
  const resourceKey = solanaRpcResourceKey(identity);
  const scheduler = getOrCreateResourceScheduler(
    resourceKey,
    createResourceProfile({
      minCapacity: config.rpcAdaptiveMinInflight,
      maxCapacity: config.solanaRpcDefaultMaxInflight,
      successWindow: config.rpcAimdSuccessWindow,
      decreaseFactor: config.rpcAimdDecreaseFactor,
      leaseTtlMs: config.resourceLeaseTtlMs,
      leaseHeartbeatMs: config.resourceLeaseHeartbeatMs,
      leaseAcquirePollMs: config.resourceLeaseAcquirePollMs,
    }),
  );
  schedulers.set(identity, scheduler);
  const isInfura = identity.startsWith("infura:");
  const intervalMs = isInfura ? config.infuraRpcIntervalMs : config.publicRpcIntervalMs;
  const requestCapacity = isInfura ? config.infuraRpcIntervalCap : config.publicRpcIntervalCap;
  weightedBudgets.set(identity, new DistributedWeightedRateBudget({
    resourceKey,
    dimension: "weighted-cost",
    capacity: config.rpcWeightedIntervalCap,
    intervalMs: Math.max(1, intervalMs),
  }));
  if (requestCapacity > 0) {
    requestBudgets.set(identity, new DistributedWeightedRateBudget({
      resourceKey,
      dimension: "requests",
      capacity: requestCapacity,
      intervalMs: Math.max(1, intervalMs),
    }));
  }
  return scheduler;
}
function endpointKey(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}
function retryableSolanaRpcClass(value: RpcErrorClass): boolean {
  return value === "rate_limit" ||
    value === "authentication" ||
    value === "transport_failure" ||
    value === "method_not_found" ||
    value === "method_restricted" ||
    value === "provider_retired" ||
    value === "provider_lag";
}
function solanaRpcCooldownMs(failureCount: number, classification: RpcErrorClass): number {
  const base = classification === "rate_limit"
    ? 15_000
    : classification === "authentication"
      ? 5 * 60_000
      : classification === "method_not_found" || classification === "method_restricted" || classification === "provider_retired"
        ? 30 * 60_000
        : 5_000;
  return Math.min(30 * 60_000, base * 2 ** Math.min(6, Math.max(0, failureCount - 1)));
}
function recordSolanaRpcSuccess(endpoint: Solana8004RpcEndpoint, elapsedMs: number): void {
  endpoint.latencyEwmaMs = endpoint.latencyEwmaMs <= 0
    ? elapsedMs
    : endpoint.latencyEwmaMs * 0.8 + elapsedMs * 0.2;
  endpoint.failureCount = 0;
  endpoint.cooldownUntil = 0;
}
function recordSolanaRpcFailure(
  endpoint: Solana8004RpcEndpoint,
  elapsedMs: number,
  classification: RpcErrorClass,
): void {
  endpoint.latencyEwmaMs = endpoint.latencyEwmaMs <= 0
    ? elapsedMs
    : endpoint.latencyEwmaMs * 0.8 + elapsedMs * 0.2;
  endpoint.failureCount += 1;
  endpoint.cooldownUntil = Date.now() + solanaRpcCooldownMs(endpoint.failureCount, classification);
}
async function solanaRpcCallSingle<T>(
  endpoint: Solana8004RpcEndpoint,
  method: string,
  params: unknown[],
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<T> {
  throwIfAborted(signal);
  const identity = endpoint.credentialKey;
  const weight = rpcWeight(method, params);
  await requestBudgets.get(identity)?.acquire(1, signal);
  await weightedBudgets.get(identity)?.acquire(weight, signal);
  endpoint.inFlight += 1;
  const startedAt = performance.now();
  try {
    const result = await endpoint.scheduler.run(async (laneSignal) => {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: `solana-8004-${++rpcId}`, method, params }),
        signal: deadlineSignal(config.rpcRequestTimeoutMs, laneSignal),
      });
      if (!response.ok) {
        const error = new Error(`Solana RPC ${method} returned HTTP ${response.status}`) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      const rawEnvelope = await readBoundedJsonBody(response, maxBytes);
      const envelope = RpcEnvelopeSchema.parse(rawEnvelope);
      if (envelope.error) {
        const error = new Error(`Solana RPC ${method} failed (${envelope.error.code ?? "unknown"}): ${envelope.error.message ?? "unknown error"}`) as Error & { status?: number };
        if ([401, 402, 403, 429, -32005].includes(envelope.error.code ?? Number.NaN)) {
          error.status = envelope.error.code === -32005 ? 429 : envelope.error.code;
        }
        throw error;
      }
      if (envelope.result === undefined) throw new Error(`Solana RPC ${method} returned no result`);
      return envelope.result as T;
    }, { signal, priority: method === "getProgramAccounts" ? 20 : 10 });
    recordSolanaRpcSuccess(endpoint, performance.now() - startedAt);
    return result;
  } catch (error) {
    const externallyAborted = signal?.aborted === true;
    const classification = classifyRpcError(error);
    if (!externallyAborted) {
      recordSolanaRpcFailure(endpoint, performance.now() - startedAt, classification);
    }
    throw error;
  } finally {
    endpoint.inFlight = Math.max(0, endpoint.inFlight - 1);
  }
}
export async function solanaRpcCall<T>(
  endpoint: Solana8004RpcEndpoint,
  method: string,
  params: unknown[],
  signal?: AbortSignal,
  maxBytes = 64 * 1024 * 1024,
): Promise<T> {
  throwIfAborted(signal);
  const alternatives = currentEndpointFallbacks.get(endpoint) ?? [];
  if (alternatives.length === 0) {
    endpoint.selectionCount += 1;
    return solanaRpcCallSingle<T>(endpoint, method, params, signal, maxBytes);
  }
  const now = Date.now();
  const seen = new Set<string>([endpoint.endpointKey]);
  const ready: Solana8004RpcEndpoint[] = endpoint.cooldownUntil <= now ? [endpoint] : [];
  const cooling: Solana8004RpcEndpoint[] = endpoint.cooldownUntil > now ? [endpoint] : [];
  for (const candidate of alternatives) {
    if (seen.has(candidate.endpointKey)) continue;
    seen.add(candidate.endpointKey);
    (candidate.cooldownUntil <= now ? ready : cooling).push(candidate);
  }
  cooling.sort((left, right) => left.cooldownUntil - right.cooldownUntil);
  // Cooldown suppresses normal selection, but a request still exhausts the full
  // compatible pool before failing. This avoids one cooling endpoint turning a
  // recoverable provider outage into a failed authoritative snapshot.
  ready.push(...cooling);
  let lastError: unknown;
  for (const candidate of ready) {
    throwIfAborted(signal);
    candidate.selectionCount += 1;
    try {
      return await solanaRpcCallSingle<T>(candidate, method, params, signal, maxBytes);
    } catch (error) {
      lastError = error;
      throwIfAborted(signal);
      if (!retryableSolanaRpcClass(classifyRpcError(error))) throw error;
    }
  }
  throw lastError ?? new Error(`No compatible Solana RPC endpoint is ready for ${method}`);
}
async function probeProvider(definition: ProviderDefinition, program: Solana8004ProgramDefinition, signal?: AbortSignal): Promise<Solana8004RpcEndpoint> {
  const credentialKey = credentialIdentity(definition.url);
  const scheduler = schedulerFor(definition.url);
  const startedAt = performance.now();
  const endpoint: Solana8004RpcEndpoint = {
    url: definition.url,
    endpointKey: endpointKey(definition.url),
    credentialKey,
    resourceKey: scheduler.resourceKey,
    providerName: definition.provider,
    selectionWeight: Math.max(1, definition.weight),
    genesisHash: "",
    validationSlot: 0n,
    firstAvailableBlock: 0n,
    minimumLedgerSlot: 0n,
    scheduler,
    cooldownUntil: 0,
    failureCount: 0,
    selectionCount: 0,
    inFlight: 0,
    latencyEwmaMs: 0,
  };
  const [genesisHash, firstAvailableBlock, minimumLedgerSlot] = await Promise.all([
    solanaRpcCall<string>(endpoint, "getGenesisHash", [], signal, 1_048_576),
    solanaRpcCall<number>(endpoint, "getFirstAvailableBlock", [], signal, 1_048_576),
    solanaRpcCall<number>(endpoint, "minimumLedgerSlot", [], signal, 1_048_576),
  ]);
  if (genesisHash !== program.genesisHash) throw new Error(`Solana RPC genesis mismatch: expected ${program.genesisHash}, observed ${genesisHash}`);
  if (!Number.isSafeInteger(firstAvailableBlock) || firstAvailableBlock < 0 || !Number.isSafeInteger(minimumLedgerSlot) || minimumLedgerSlot < 0) {
    throw new Error("Solana RPC returned an invalid history floor");
  }
  endpoint.genesisHash = genesisHash;
  endpoint.firstAvailableBlock = BigInt(firstAvailableBlock);
  endpoint.minimumLedgerSlot = BigInt(minimumLedgerSlot);
  const account = await solanaRpcCall<{ context: { slot: number }; value: SolanaRpcAccount | null }>(endpoint, "getAccountInfo", [program.programId, { commitment: "finalized", encoding: "base64" }], signal, 4 * 1024 * 1024);
  if (!Number.isSafeInteger(account.context?.slot) || account.context.slot < 0) {
    throw new Error(`Solana 8004 program probe returned invalid context slot ${String(account.context?.slot)}`);
  }
  if (!account.value?.executable) throw new Error(`Solana 8004 program ${program.programId} is absent or not executable`);
  endpoint.validationSlot = BigInt(account.context.slot);
  endpoint.latencyEwmaMs = performance.now() - startedAt;
  await prisma.indexerEndpointState.upsert({
    where: { endpointKey: endpoint.endpointKey },
    create: {
      endpointKey: endpoint.endpointKey,
      protocol: "solana-json-rpc",
      endpointUrl: redactRpcUrl(endpoint.url),
      configuredNetwork: "mainnet-beta",
      observedNetwork: genesisHash,
      configurationGeneration: `${program.programId}:${program.idlHash}`,
      capabilities: { finalized: true, getProgramAccounts: true, getMultipleAccounts: true, getSignaturesForAddress: true, getTransaction: true, firstAvailableBlock: String(firstAvailableBlock), minimumLedgerSlot: String(minimumLedgerSlot), provider: definition.provider },
      latestHead: BigInt(account.context.slot),
      historyFloor: BigInt(firstAvailableBlock),
      verifiedAt: new Date(),
    },
    update: {
      observedNetwork: genesisHash,
      configurationGeneration: `${program.programId}:${program.idlHash}`,
      capabilities: { finalized: true, getProgramAccounts: true, getMultipleAccounts: true, getSignaturesForAddress: true, getTransaction: true, firstAvailableBlock: String(firstAvailableBlock), minimumLedgerSlot: String(minimumLedgerSlot), provider: definition.provider },
      latestHead: BigInt(account.context.slot),
      historyFloor: BigInt(firstAvailableBlock),
      disabledReason: null,
      verifiedAt: new Date(),
    },
  });
  return endpoint;
}
function endpointSelectionScore(endpoint: Solana8004RpcEndpoint): number {
  const fairness = (endpoint.selectionCount / Math.max(1, endpoint.selectionWeight)) * 1_000;
  const quality = Math.max(0, 10 - endpoint.selectionWeight) * 500;
  const failures = endpoint.failureCount * 10_000;
  const inFlight = endpoint.inFlight * 5_000;
  return fairness + quality + failures + inFlight + endpoint.latencyEwmaMs;
}
let currentEndpointSelectionCounter = 0;
function orderedCurrentEndpoints(values: readonly Solana8004RpcEndpoint[]): Solana8004RpcEndpoint[] {
  if (values.length <= 1) return [...values];
  const now = Date.now();
  const ready = values.filter((endpoint) => endpoint.cooldownUntil <= now);
  const candidates = ready.length > 0 ? ready : values;
  const offset = currentEndpointSelectionCounter++ % candidates.length;
  const rotated: Solana8004RpcEndpoint[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    rotated.push(candidates[(offset + index) % candidates.length]!);
  }
  // Stable sort retains the rotated order as the deterministic tie-breaker.
  rotated.sort((left, right) => endpointSelectionScore(left) - endpointSelectionScore(right));
  return rotated;
}
async function compatibleEndpoints(
  program: Solana8004ProgramDefinition,
  signal?: AbortSignal,
): Promise<Solana8004RpcEndpoint[]> {
  throwIfAborted(signal);
  const providers = configuredProviders();
  if (providers.length === 0) throw new Error("No Solana JSON-RPC endpoint is configured for direct Solana 8004 indexing");
  const key = `${program.programId}:${program.idlHash}:${configuredProviderCache!.fingerprint}`;
  const now = Date.now();
  if (!endpointCache || endpointCache.key !== key || endpointCache.expiresAt <= now) {
    const promise = mapWithConcurrency(
      providers,
      ENDPOINT_PROBE_CONCURRENCY,
      async (provider) => {
        try {
          return { endpoint: await probeProvider(provider, program), error: null };
        } catch (error) {
          return { endpoint: null, error };
        }
      },
    ).then((settled) => {
      const available = settled.flatMap((result) => result.endpoint ? [result.endpoint] : []);
      if (available.length === 0) {
        const failures = settled.flatMap((result) => result.error == null
          ? []
          : [result.error instanceof Error ? result.error.message : String(result.error)]);
        throw new Error(`No compatible Solana 8004 RPC endpoint is available: ${failures.slice(0, 4).join("; ")}`);
      }
      available.sort((left, right) => {
        if (left.minimumLedgerSlot !== right.minimumLedgerSlot) {
          return left.minimumLedgerSlot < right.minimumLedgerSlot ? -1 : 1;
        }
        return left.endpointKey.localeCompare(right.endpointKey);
      });
      return available;
    });
    endpointCache = { key, expiresAt: now + ENDPOINT_CACHE_TTL_MS, promise };
    promise.catch(() => {
      if (endpointCache?.promise === promise) endpointCache = null;
    });
  }
  const endpoints = await endpointCache.promise;
  throwIfAborted(signal);
  return endpoints;
}
export async function selectSolana8004RpcEndpoint(program: Solana8004ProgramDefinition, signal?: AbortSignal): Promise<Solana8004RpcEndpoint> {
  const ordered = orderedCurrentEndpoints(await compatibleEndpoints(program, signal));
  const selected = ordered[0];
  if (!selected) throw new Error("No compatible Solana 8004 RPC endpoint is available");
  currentEndpointFallbacks.set(selected, ordered.slice(1));
  return selected;
}
export async function selectSolana8004HistoryRpcEndpoints(
  program: Solana8004ProgramDefinition,
  targetSlot?: bigint | null,
  signal?: AbortSignal,
): Promise<Solana8004RpcEndpoint[]> {
  const available = await compatibleEndpoints(program, signal);
  // The shared cache is already ordered by history floor. For any target slot,
  // eligible providers are therefore a prefix and no per-transaction sort is
  // required on the 100k-signature trust path.
  void targetSlot;
  return available;
}
export async function selectSolana8004HistoryRpcEndpoint(
  program: Solana8004ProgramDefinition,
  targetSlot?: bigint | null,
  signal?: AbortSignal,
): Promise<Solana8004RpcEndpoint> {
  const selected = (await selectSolana8004HistoryRpcEndpoints(program, targetSlot, signal))[0];
  if (!selected) throw new Error("No compatible Solana 8004 history endpoint is available");
  return selected;
}
export async function fetchSolana8004Transaction(input: {
  endpoint: Solana8004RpcEndpoint;
  signature: string;
  signal?: AbortSignal;
}): Promise<Solana8004RawTransaction | null> {
  return solanaRpcCall<Solana8004RawTransaction | null>(input.endpoint, "getTransaction", [input.signature, {
    commitment: "finalized",
    encoding: "json",
    maxSupportedTransactionVersion: 0,
  }], input.signal, 64 * 1024 * 1024);
}
