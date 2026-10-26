import { parseOptionalContentLength } from "../lib/strict-integer.js";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import {
  Connection,
  PublicKey,
  type CompiledInstruction,
  type MessageCompiledInstruction,
  type ParsedInstruction,
  type PartiallyDecodedInstruction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getInfuraSolanaRpcUrls, redactRpcErrorText, redactRpcUrl } from "./rpc.js";
import { PUBLIC_SOLANA_RPC_PROVIDERS, type PublicRpcProviderDefinition } from "./public-rpc-providers.js";
import { validateSolanaTransactionSignature } from "../lib/solana-protocol.js";
import {
  decodeSolanaAgentInstruction,
  SOLANA_AGENT_INSTRUCTION_DECODER_VERSION,
  summarizeDecodedSolanaInstructions,
} from "../lib/solana-agent-instruction-decoder.js";
import { solanaMinContextSlotNumber } from "../lib/solana-signature-pagination.js";
import { parseOptionalStrictUnsignedInteger } from "../lib/strict-integer.js";
import { mapWithConcurrency } from "@/lib/async-pool";
import {
  parseSolanaSignatureRpcBytes,
  type ExactSolanaSignatureInfo,
} from "../lib/solana-signature-rpc.js";
const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const COMMITMENT = "finalized" as const;
type SolanaEndpoint = {
  url: string;
  redactedUrl: string;
  key: string;
  providerName: string;
  weight: number;
  latencyEwmaMs: number;
  failureCount: number;
  selectionCount: number;
  inFlight: number;
  connection: Connection;
  genesisHash: string;
  rpcVersion: string;
  firstAvailableBlock: bigint;
  minimumLedgerSlot: bigint;
};
export type SolanaTransactionEvidence = {
  status:
    | "found_successful"
    | "found_failed"
    | "found_metadata_unavailable"
    | "not_confirmed"
    | "not_available_on_provider"
    | "history_pruned"
    | "unsupported_version"
    | "malformed_response";
  successful: boolean;
  expectedProgramExecuted: boolean;
  transactionVersion: string | null;
  resolvedAccountKeys: string[];
};
let cachedEndpoints: {
  configurationKey: string;
  expiresAt: number;
  promise: Promise<SolanaEndpoint[]>;
} | null = null;
let configuredUrlCache: { values: PublicRpcProviderDefinition[]; fingerprint: string } | null = null;
const ENDPOINT_PROBE_CONCURRENCY = 4;
const ENDPOINT_PROBE_TTL_MS = Math.max(
  30_000,
  parseOptionalStrictUnsignedInteger(process.env.SOLANA_RPC_CAPABILITY_TTL_MS, "SOLANA_RPC_CAPABILITY_TTL_MS", 300_000, { maximum: 86_400_000 }),
);
const SOLANA_RPC_DEGRADED_LATENCY_MS = parseOptionalStrictUnsignedInteger(
  process.env.SOLANA_RPC_DEGRADED_LATENCY_MS,
  "SOLANA_RPC_DEGRADED_LATENCY_MS",
  2_500,
  { maximum: 60_000 },
);
const SOLANA_RPC_UNHEALTHY_LATENCY_MS = Math.max(
  SOLANA_RPC_DEGRADED_LATENCY_MS + 1,
  parseOptionalStrictUnsignedInteger(
    process.env.SOLANA_RPC_UNHEALTHY_LATENCY_MS,
    "SOLANA_RPC_UNHEALTHY_LATENCY_MS",
    8_000,
    { maximum: 60_000 },
  ),
);
type SolanaRpcHealth = "healthy" | "degraded" | "unhealthy";
function solanaEndpointHealth(latencyMs: number): SolanaRpcHealth {
  if (latencyMs >= SOLANA_RPC_UNHEALTHY_LATENCY_MS) return "unhealthy";
  if (latencyMs >= SOLANA_RPC_DEGRADED_LATENCY_MS) return "degraded";
  return "healthy";
}
function solanaEndpointHealthPenalty(endpoint: SolanaEndpoint): number {
  const health = solanaEndpointHealth(endpoint.latencyEwmaMs);
  if (health === "unhealthy") return 100_000;
  if (health === "degraded") return 25_000;
  return 0;
}
function boundedRpc<T>(operation: Promise<T>, label: string, timeoutMs = 15_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
function configuredUrls(): PublicRpcProviderDefinition[] {
  if (configuredUrlCache) return configuredUrlCache.values;
  const explicit = [
    ...(process.env.SOLANA_RPC_URLS ?? "").split(/[\s,]+/),
    process.env.SOLANA_RPC_URL ?? "",
    process.env.SOLANA_RPC_FALLBACK_URL ?? "",
    process.env.SOLANA_MAINNET_RPC_URL ?? "",
    process.env.HELIUS_RPC_URL ?? "",
  ].map((value) => value.trim()).filter(Boolean).map((url) => ({ url, provider: "operator-configured", weight: 8 }));
  const infura = getInfuraSolanaRpcUrls().map((url) => ({ url, provider: "Infura", weight: 6 }));
  const publicProviders = config.publicRpcProvidersEnabled ? [...PUBLIC_SOLANA_RPC_PROVIDERS] : [];
  const values = [...explicit, ...infura, ...publicProviders];
  const seen = new Set<string>();
  const out: PublicRpcProviderDefinition[] = [];
  for (const value of values) {
    try {
      const normalized = new URL(value.url).toString().replace(/\/$/, "");
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ ...value, url: normalized });
    } catch {
      // Ignore invalid operator values before constructing a Connection.
    }
  }
  configuredUrlCache = {
    values: out,
    fingerprint: createHash("sha256").update(JSON.stringify(out)).digest("hex"),
  };
  return out;
}
function endpointKey(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}
async function probeEndpoint(definition: PublicRpcProviderDefinition): Promise<SolanaEndpoint> {
  const url = definition.url;
  const startedAt = performance.now();
  const connection = new Connection(url, {
    commitment: COMMITMENT,
    confirmTransactionInitialTimeout: 15_000,
    disableRetryOnRateLimit: true,
  });
  const [genesisHash, version, firstAvailableBlock, minimumLedgerSlot] = await Promise.all([
    boundedRpc(connection.getGenesisHash(), "getGenesisHash"),
    boundedRpc(connection.getVersion(), "getVersion"),
    boundedRpc(connection.getFirstAvailableBlock(), "getFirstAvailableBlock"),
    boundedRpc(connection.getMinimumLedgerSlot(), "minimumLedgerSlot"),
  ]);
  const expectedGenesis = process.env.SOLANA_EXPECTED_GENESIS_HASH?.trim() || MAINNET_GENESIS_HASH;
  if (genesisHash !== expectedGenesis) {
    throw new Error(`Solana RPC cluster mismatch: expected genesis ${expectedGenesis}, observed ${genesisHash}`);
  }
  const key = endpointKey(url);
  const redactedUrl = redactRpcUrl(url);
  await prisma.indexerEndpointState.upsert({
    where: { endpointKey: key },
    create: {
      endpointKey: key,
      protocol: "solana-json-rpc",
      endpointUrl: redactedUrl,
      configuredNetwork: "mainnet-beta",
      observedNetwork: genesisHash,
      configurationGeneration: `${genesisHash}:${version["solana-core"]}`,
      capabilities: {
        commitment: COMMITMENT,
        maxSupportedTransactionVersion: 0,
        firstAvailableBlock: String(firstAvailableBlock),
        minimumLedgerSlot: String(minimumLedgerSlot),
        provider: definition.provider,
        selectionWeight: definition.weight,
        probeLatencyMs: performance.now() - startedAt,
      },
      historyFloor: BigInt(firstAvailableBlock),
      verifiedAt: new Date(),
    },
    update: {
      observedNetwork: genesisHash,
      capabilities: {
        commitment: COMMITMENT,
        maxSupportedTransactionVersion: 0,
        firstAvailableBlock: String(firstAvailableBlock),
        minimumLedgerSlot: String(minimumLedgerSlot),
        provider: definition.provider,
        selectionWeight: definition.weight,
        probeLatencyMs: performance.now() - startedAt,
      },
      historyFloor: BigInt(firstAvailableBlock),
      disabledReason: null,
      verifiedAt: new Date(),
    },
  });
  return {
    url,
    redactedUrl,
    key,
    providerName: definition.provider,
    weight: Math.max(1, definition.weight),
    latencyEwmaMs: performance.now() - startedAt,
    failureCount: 0,
    selectionCount: 0,
    inFlight: 0,
    connection,
    genesisHash,
    rpcVersion: version["solana-core"],
    firstAvailableBlock: BigInt(firstAvailableBlock),
    minimumLedgerSlot: BigInt(minimumLedgerSlot),
  };
}
async function endpoints(): Promise<SolanaEndpoint[]> {
  const urls = configuredUrls();
  const expectedGenesis = process.env.SOLANA_EXPECTED_GENESIS_HASH?.trim() || MAINNET_GENESIS_HASH;
  const configurationKey = `${configuredUrlCache!.fingerprint}:${expectedGenesis}`;
  const now = Date.now();
  if (!cachedEndpoints || cachedEndpoints.configurationKey !== configurationKey || cachedEndpoints.expiresAt <= now) {
    const promise = (async () => {
      const settled = await mapWithConcurrency(urls, ENDPOINT_PROBE_CONCURRENCY, async (definition) => {
        try {
          return { endpoint: await probeEndpoint(definition), error: null };
        } catch (error) {
          return { endpoint: null, error };
        }
      });
      const available = settled.flatMap((result) => result.endpoint ? [result.endpoint] : []);
      if (available.length === 0) {
        const lastError = settled.flatMap((result) => result.error == null ? [] : [result.error]).at(-1);
        throw lastError ?? new Error("No Solana RPC endpoint is configured for transaction verification");
      }
      return available;
    })();
    cachedEndpoints = { configurationKey, expiresAt: now + ENDPOINT_PROBE_TTL_MS, promise };
    promise.catch(() => {
      if (cachedEndpoints?.promise === promise) cachedEndpoints = null;
    });
  }
  return cachedEndpoints.promise;
}
let solanaRpcHealthTimer: NodeJS.Timeout | null = null;
let solanaRpcHealthSweepPromise: Promise<void> | null = null;
let solanaRpcHealthMonitorStopped = true;
export async function runSolanaRpcHealthSweep(): Promise<void> {
  if (solanaRpcHealthSweepPromise) return solanaRpcHealthSweepPromise;
  solanaRpcHealthSweepPromise = (async () => {
    cachedEndpoints = null;
    const configured = configuredUrls();
    const available = await endpoints();
    const providerHealth = available.map((endpoint) => ({
      endpoint,
      health: solanaEndpointHealth(endpoint.latencyEwmaMs),
    }));
    logger.info(
      "Solana RPC provider health sweep completed",
      {
        configured: configured.length,
        routable: available.length,
        healthy: providerHealth.filter(({ health }) => health === "healthy").length,
        degraded: providerHealth.filter(({ health }) => health === "degraded").length,
        unhealthy:
          configured.length - available.length +
          providerHealth.filter(({ health }) => health === "unhealthy").length,
        providers: providerHealth.map(({ endpoint, health }) => ({
          provider: endpoint.providerName,
          endpoint: endpoint.redactedUrl,
          health,
          latencyMs: Math.round(endpoint.latencyEwmaMs),
          firstAvailableBlock: endpoint.firstAvailableBlock.toString(),
        })),
      },
      "rpc",
    );
  })().finally(() => { solanaRpcHealthSweepPromise = null; });
  return solanaRpcHealthSweepPromise;
}
function scheduleSolanaRpcHealthSweep(delayMs: number): void {
  if (solanaRpcHealthMonitorStopped) return;
  solanaRpcHealthTimer = setTimeout(() => {
    void runSolanaRpcHealthSweep()
      .catch((error) => logger.warn("Solana RPC provider health sweep failed", { error: redactRpcErrorText(error instanceof Error ? error.message : String(error)) }, "rpc"))
      .finally(() => scheduleSolanaRpcHealthSweep(Math.max(30_000, Math.round(ENDPOINT_PROBE_TTL_MS * (0.85 + Math.random() * 0.3)))));
  }, delayMs);
  solanaRpcHealthTimer.unref?.();
}
export function startSolanaRpcHealthMonitor(): void {
  if (!solanaRpcHealthMonitorStopped) return;
  solanaRpcHealthMonitorStopped = false;
  scheduleSolanaRpcHealthSweep(Math.floor(Math.random() * Math.min(30_000, ENDPOINT_PROBE_TTL_MS)));
}
export async function stopSolanaRpcHealthMonitor(): Promise<void> {
  solanaRpcHealthMonitorStopped = true;
  if (solanaRpcHealthTimer) clearTimeout(solanaRpcHealthTimer);
  solanaRpcHealthTimer = null;
  const sweep = solanaRpcHealthSweepPromise;
  if (!sweep) return;
  await Promise.race([
    sweep,
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      timer.unref?.();
    }),
  ]);
}
let solanaSelectionCounter = 0;
function orderedSolanaEndpoints(values: readonly SolanaEndpoint[]): SolanaEndpoint[] {
  if (values.length <= 1) return [...values];
  const offset = solanaSelectionCounter++ % values.length;
  const rotated: SolanaEndpoint[] = [];
  for (let index = 0; index < values.length; index += 1) {
    rotated.push(values[(offset + index) % values.length]!);
  }
  return rotated.sort((left, right) => {
    const leftScore = solanaEndpointHealthPenalty(left) + (left.selectionCount / Math.max(1, left.weight)) * 1_000 + left.failureCount * 10_000 + left.inFlight * 5_000 + left.latencyEwmaMs;
    const rightScore = solanaEndpointHealthPenalty(right) + (right.selectionCount / Math.max(1, right.weight)) * 1_000 + right.failureCount * 10_000 + right.inFlight * 5_000 + right.latencyEwmaMs;
    return leftScore - rightScore;
  });
}
function recordSolanaEndpointSuccess(endpoint: SolanaEndpoint, elapsedMs: number): void {
  endpoint.latencyEwmaMs = endpoint.latencyEwmaMs * 0.8 + elapsedMs * 0.2;
  endpoint.failureCount = 0;
}
function recordSolanaEndpointFailure(endpoint: SolanaEndpoint, elapsedMs: number): void {
  endpoint.latencyEwmaMs = endpoint.latencyEwmaMs * 0.8 + elapsedMs * 0.2;
  endpoint.failureCount += 1;
}
function staticAccountKeys(response: VersionedTransactionResponse): string[] {
  const message = response.transaction.message as unknown as {
    staticAccountKeys?: PublicKey[];
    accountKeys?: PublicKey[];
  };
  return (message.staticAccountKeys ?? message.accountKeys ?? []).map((key) => key.toBase58());
}
function resolvedKeys(response: VersionedTransactionResponse): {
  staticKeys: string[];
  writable: string[];
  readonly: string[];
  resolved: string[];
} {
  const staticKeys = staticAccountKeys(response);
  const writable = response.meta?.loadedAddresses?.writable.map((key) => key.toBase58()) ?? [];
  const readonly = response.meta?.loadedAddresses?.readonly.map((key) => key.toBase58()) ?? [];
  return { staticKeys, writable, readonly, resolved: [...staticKeys, ...writable, ...readonly] };
}
type InstructionLike = CompiledInstruction | MessageCompiledInstruction | ParsedInstruction | PartiallyDecodedInstruction;
function compiledInstruction(value: InstructionLike): { programIdIndex: number; accountIndexes: number[]; data: string } | null {
  if (!("programIdIndex" in value)) return null;
  const accounts = "accountKeyIndexes" in value ? value.accountKeyIndexes : value.accounts;
  return {
    programIdIndex: value.programIdIndex,
    accountIndexes: [...accounts],
    data: typeof value.data === "string" ? value.data : bs58.encode(value.data),
  };
}
function instructionProjection(value: InstructionLike, keys: string[], identity: Record<string, unknown>) {
  const compiled = compiledInstruction(value);
  if (compiled) {
    const programId = keys[compiled.programIdIndex] ?? null;
    const accounts = compiled.accountIndexes.map((index) => keys[index] ?? null);
    return {
      ...identity,
      programId,
      programIdIndex: compiled.programIdIndex,
      accounts,
      accountIndexes: compiled.accountIndexes,
      data: compiled.data,
      decoded: decodeSolanaAgentInstruction({ programId, accounts, data: compiled.data }),
    };
  }
  const parsed = value as ParsedInstruction | PartiallyDecodedInstruction;
  const programId = parsed.programId.toBase58();
  const accounts = "accounts" in parsed ? parsed.accounts.map((key) => key.toBase58()) : [];
  const parsedValue = "parsed" in parsed ? parsed.parsed : null;
  const data = "data" in parsed ? parsed.data : null;
  return {
    ...identity,
    programId,
    parsed: parsedValue,
    accounts,
    data,
    decoded: decodeSolanaAgentInstruction({ programId, accounts, data, parsed: parsedValue }),
  };
}
function projectInstructions(response: VersionedTransactionResponse, keys: string[]) {
  const message = response.transaction.message as unknown as { compiledInstructions?: InstructionLike[]; instructions?: InstructionLike[] };
  const outerSource = message.compiledInstructions ?? message.instructions ?? [];
  const outer = outerSource.map((instruction, outerIndex) => instructionProjection(instruction, keys, { outerIndex, innerOrdinal: null, stackHeight: null }));
  const inner = (response.meta?.innerInstructions ?? []).flatMap((group) => group.instructions.map((instruction, innerOrdinal) => instructionProjection(
    instruction,
    keys,
    {
      outerIndex: group.index,
      innerOrdinal,
      stackHeight: "stackHeight" in instruction ? instruction.stackHeight ?? null : null,
    },
  )));
  return { outer, inner };
}
function transactionVersion(response: VersionedTransactionResponse): string {
  return response.version === "legacy" ? "legacy" : String(response.version);
}
async function persist(input: {
  endpoint: SolanaEndpoint;
  signature: string;
  expectedProgramId: string;
  slot: bigint | null;
  status: SolanaTransactionEvidence["status"];
  response: VersionedTransactionResponse | null;
  expectedProgramExecuted: boolean;
  keys?: ReturnType<typeof resolvedKeys>;
  instructions?: ReturnType<typeof projectInstructions>;
}): Promise<void> {
  const existing = await prisma.solanaTransactionObservation.findUnique({
    where: { signature: input.signature },
    select: { status: true, expectedProgramId: true },
  });
  const terminal = new Set(["found_successful", "found_failed"]);
  if (existing?.expectedProgramId === input.expectedProgramId && terminal.has(existing.status) && !terminal.has(input.status)) {
    return;
  }
  await prisma.solanaTransactionObservation.upsert({
    where: { signature: input.signature },
    create: {
      signature: input.signature,
      slot: input.response ? BigInt(input.response.slot) : input.slot,
      transactionVersion: input.response ? transactionVersion(input.response) : null,
      status: input.status,
      commitment: COMMITMENT,
      metaAvailable: input.response?.meta != null,
      blockTime: input.response?.blockTime == null ? null : new Date(input.response.blockTime * 1_000),
      logMessages: input.response?.meta?.logMessages as never,
      executionError: input.response?.meta?.err == null ? undefined : input.response.meta.err as never,
      expectedProgramId: input.expectedProgramId,
      expectedProgramExecuted: input.expectedProgramExecuted,
      staticAccountKeys: input.keys?.staticKeys as never,
      loadedWritableKeys: input.keys?.writable as never,
      loadedReadonlyKeys: input.keys?.readonly as never,
      resolvedAccountKeys: input.keys?.resolved as never,
      outerInstructions: input.instructions?.outer as never,
      innerInstructions: input.instructions?.inner as never,
      decodedInstructions: input.instructions
        ? summarizeDecodedSolanaInstructions(input.instructions.outer, input.instructions.inner) as never
        : undefined,
      instructionDecoderVersion: input.instructions ? SOLANA_AGENT_INSTRUCTION_DECODER_VERSION : null,
      genesisHash: input.endpoint.genesisHash,
      rpcVersion: input.endpoint.rpcVersion,
      firstAvailableBlock: input.endpoint.firstAvailableBlock,
      minimumLedgerSlot: input.endpoint.minimumLedgerSlot,
      endpointKey: input.endpoint.key,
    },
    update: {
      slot: input.response ? BigInt(input.response.slot) : input.slot,
      transactionVersion: input.response ? transactionVersion(input.response) : null,
      status: input.status,
      metaAvailable: input.response?.meta != null,
      blockTime: input.response?.blockTime == null ? null : new Date(input.response.blockTime * 1_000),
      logMessages: input.response?.meta?.logMessages as never,
      executionError: input.response?.meta?.err == null ? undefined : input.response.meta.err as never,
      expectedProgramId: input.expectedProgramId,
      expectedProgramExecuted: input.expectedProgramExecuted,
      staticAccountKeys: input.keys?.staticKeys as never,
      loadedWritableKeys: input.keys?.writable as never,
      loadedReadonlyKeys: input.keys?.readonly as never,
      resolvedAccountKeys: input.keys?.resolved as never,
      outerInstructions: input.instructions?.outer as never,
      innerInstructions: input.instructions?.inner as never,
      decodedInstructions: input.instructions
        ? summarizeDecodedSolanaInstructions(input.instructions.outer, input.instructions.inner) as never
        : undefined,
      instructionDecoderVersion: input.instructions ? SOLANA_AGENT_INSTRUCTION_DECODER_VERSION : null,
      genesisHash: input.endpoint.genesisHash,
      rpcVersion: input.endpoint.rpcVersion,
      firstAvailableBlock: input.endpoint.firstAvailableBlock,
      minimumLedgerSlot: input.endpoint.minimumLedgerSlot,
      endpointKey: input.endpoint.key,
      verifiedAt: new Date(),
    },
  });
}
function classifyGetTransactionError(error: unknown): SolanaTransactionEvidence["status"] {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (/unsupported transaction version|maxsupportedtransactionversion/.test(message)) return "unsupported_version";
  if (/not confirmed|commitment/.test(message)) return "not_confirmed";
  if (/history|pruned|ledger|block not available/.test(message)) return "history_pruned";
  return "not_available_on_provider";
}
export async function verifySolanaTransaction(input: {
  signature: string;
  sourceSlot: bigint | null;
  expectedProgramId: string;
  signal?: AbortSignal;
}): Promise<SolanaTransactionEvidence> {
  validateSolanaTransactionSignature(input.signature);
  new PublicKey(input.expectedProgramId);
  const cached = await prisma.solanaTransactionObservation.findUnique({
    where: { signature: input.signature },
    select: {
      slot: true,
      status: true,
      commitment: true,
      expectedProgramId: true,
      expectedProgramExecuted: true,
      transactionVersion: true,
      resolvedAccountKeys: true,
    },
  });
  const cacheIsExact = cached != null
    && cached.commitment === COMMITMENT
    && cached.expectedProgramId === input.expectedProgramId
    && (input.sourceSlot == null || cached.slot === input.sourceSlot)
    && (cached.status === "found_successful" || cached.status === "found_failed");
  if (cacheIsExact) {
    const resolvedAccountKeys = Array.isArray(cached.resolvedAccountKeys)
      ? cached.resolvedAccountKeys.filter((value): value is string => typeof value === "string")
      : [];
    return {
      status: cached.status as "found_successful" | "found_failed",
      successful: cached.status === "found_successful" && cached.expectedProgramExecuted,
      expectedProgramExecuted: cached.expectedProgramExecuted,
      transactionVersion: cached.transactionVersion,
      resolvedAccountKeys,
    };
  }
  let last: SolanaTransactionEvidence | null = null;
  for (const endpoint of orderedSolanaEndpoints(await endpoints())) {
    if (input.signal?.aborted) throw input.signal.reason;
    endpoint.selectionCount += 1;
    endpoint.inFlight += 1;
    const endpointStartedAt = performance.now();
    try {
      if (input.sourceSlot != null && input.sourceSlot < endpoint.firstAvailableBlock) {
        const evidence: SolanaTransactionEvidence = {
          status: "history_pruned",
          successful: false,
          expectedProgramExecuted: false,
          transactionVersion: null,
          resolvedAccountKeys: [],
        };
        await persist({ endpoint, signature: input.signature, expectedProgramId: input.expectedProgramId, slot: input.sourceSlot, status: evidence.status, response: null, expectedProgramExecuted: false });
        last = evidence;
        continue;
      }
      let response: VersionedTransactionResponse | null;
      try {
        response = await boundedRpc(endpoint.connection.getTransaction(input.signature, {
          commitment: COMMITMENT,
          maxSupportedTransactionVersion: 0,
        }), "getTransaction", 20_000);
      } catch (error) {
        recordSolanaEndpointFailure(endpoint, performance.now() - endpointStartedAt);
        const status = classifyGetTransactionError(error);
        const evidence: SolanaTransactionEvidence = { status, successful: false, expectedProgramExecuted: false, transactionVersion: null, resolvedAccountKeys: [] };
        await persist({ endpoint, signature: input.signature, expectedProgramId: input.expectedProgramId, slot: input.sourceSlot, status, response: null, expectedProgramExecuted: false });
        last = evidence;
        continue;
      }
      if (!response) {
        let historicalStatus: Awaited<ReturnType<Connection["getSignatureStatuses"]>>["value"][number] = null;
        try {
          const statuses = await boundedRpc(
            endpoint.connection.getSignatureStatuses([input.signature], { searchTransactionHistory: true }),
            "getSignatureStatuses(searchTransactionHistory)",
            15_000,
          );
          historicalStatus = statuses.value[0] ?? null;
        } catch {
          // The endpoint may not expose transaction-history status even when getTransaction is supported.
        }
        const status: SolanaTransactionEvidence["status"] = historicalStatus
          ? historicalStatus.err == null ? "found_metadata_unavailable" : "found_failed"
          : input.sourceSlot != null && input.sourceSlot < endpoint.minimumLedgerSlot
            ? "history_pruned"
            : "not_available_on_provider";
        const evidence: SolanaTransactionEvidence = { status, successful: false, expectedProgramExecuted: false, transactionVersion: null, resolvedAccountKeys: [] };
        await persist({ endpoint, signature: input.signature, expectedProgramId: input.expectedProgramId, slot: input.sourceSlot, status, response: null, expectedProgramExecuted: false });
        last = evidence;
        recordSolanaEndpointSuccess(endpoint, performance.now() - endpointStartedAt);
        continue;
      }
      if (!Number.isSafeInteger(response.slot) || response.slot < 0) {
        const evidence: SolanaTransactionEvidence = { status: "malformed_response", successful: false, expectedProgramExecuted: false, transactionVersion: transactionVersion(response), resolvedAccountKeys: [] };
        await persist({ endpoint, signature: input.signature, expectedProgramId: input.expectedProgramId, slot: input.sourceSlot, status: evidence.status, response: null, expectedProgramExecuted: false });
        last = evidence;
        recordSolanaEndpointFailure(endpoint, performance.now() - endpointStartedAt);
        continue;
      }
      if (!response.meta) {
        const evidence: SolanaTransactionEvidence = { status: "found_metadata_unavailable", successful: false, expectedProgramExecuted: false, transactionVersion: transactionVersion(response), resolvedAccountKeys: [] };
        await persist({ endpoint, signature: input.signature, expectedProgramId: input.expectedProgramId, slot: input.sourceSlot, status: evidence.status, response, expectedProgramExecuted: false });
        last = evidence;
        recordSolanaEndpointSuccess(endpoint, performance.now() - endpointStartedAt);
        continue;
      }
      const keys = resolvedKeys(response);
      const instructions = projectInstructions(response, keys.resolved);
      const expectedProgramExecuted = [...instructions.outer, ...instructions.inner].some((instruction) => instruction.programId === input.expectedProgramId);
      const successful = response.meta.err == null && expectedProgramExecuted;
      const status = response.meta.err == null ? "found_successful" : "found_failed";
      const evidence: SolanaTransactionEvidence = {
        status,
        successful,
        expectedProgramExecuted,
        transactionVersion: transactionVersion(response),
        resolvedAccountKeys: keys.resolved,
      };
      await persist({ endpoint, signature: input.signature, expectedProgramId: input.expectedProgramId, slot: input.sourceSlot, status, response, expectedProgramExecuted, keys, instructions });
      recordSolanaEndpointSuccess(endpoint, performance.now() - endpointStartedAt);
      if (successful) return evidence;
      last = evidence;
    } finally {
      endpoint.inFlight = Math.max(0, endpoint.inFlight - 1);
    }
  }
  return last ?? { status: "not_available_on_provider", successful: false, expectedProgramExecuted: false, transactionVersion: null, resolvedAccountKeys: [] };
}
const MAX_SIGNATURE_PAGE_BYTES = Math.max(
  64 * 1_024,
  parseOptionalStrictUnsignedInteger(process.env.SOLANA_SIGNATURE_PAGE_MAX_BYTES, "SOLANA_SIGNATURE_PAGE_MAX_BYTES", 8 * 1_024 * 1_024, { maximum: 64 * 1_024 * 1_024 }),
);
async function readBoundedRpcBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = parseOptionalContentLength(response.headers.get("content-length"), "Solana RPC Content-Length");
  if (declared != null && declared > maxBytes) throw new Error(`Solana RPC response exceeds ${maxBytes} bytes`);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error(`Solana RPC response exceeds ${maxBytes} bytes`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`Solana RPC response exceeds ${maxBytes} bytes`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
async function rawSignaturePage(endpoint: SolanaEndpoint, input: {
  address: string;
  before?: string;
  until?: string;
  limit: number;
  minContextSlot?: number;
  signal?: AbortSignal;
}): Promise<ExactSolanaSignatureInfo[]> {
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason ?? new Error("Solana signature request cancelled"));
  input.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("getSignaturesForAddress timed out")), 20_000);
  timer.unref?.();
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [input.address, {
          before: input.before,
          until: input.until,
          limit: input.limit,
          commitment: COMMITMENT,
          minContextSlot: input.minContextSlot,
        }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status} for getSignaturesForAddress`);
    return parseSolanaSignatureRpcBytes(
      await readBoundedRpcBytes(response, MAX_SIGNATURE_PAGE_BYTES),
    );
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
  }
}
export async function getFinalizedSignaturePage(input: {
  address: string;
  before?: string;
  until?: string;
  limit?: number;
  minContextSlot?: bigint | string | number;
  signal?: AbortSignal;
}): Promise<ExactSolanaSignatureInfo[]> {
  const key = new PublicKey(input.address);
  if (input.before) validateSolanaTransactionSignature(input.before);
  if (input.until) validateSolanaTransactionSignature(input.until);
  const limit = Math.max(1, Math.min(1_000, input.limit ?? 1_000));
  let lastError: unknown;
  for (const endpoint of orderedSolanaEndpoints(await endpoints())) {
    if (input.signal?.aborted) throw input.signal.reason;
    endpoint.selectionCount += 1;
    endpoint.inFlight += 1;
    const endpointStartedAt = performance.now();
    try {
      const page = await rawSignaturePage(endpoint, {
        address: key.toBase58(),
        before: input.before,
        until: input.until,
        limit,
        minContextSlot: input.minContextSlot == null ? undefined : solanaMinContextSlotNumber(input.minContextSlot),
        signal: input.signal,
      });
      recordSolanaEndpointSuccess(endpoint, performance.now() - endpointStartedAt);
      return page;
    } catch (error) {
      recordSolanaEndpointFailure(endpoint, performance.now() - endpointStartedAt);
      lastError = error;
    } finally {
      endpoint.inFlight = Math.max(0, endpoint.inFlight - 1);
    }
  }
  throw lastError ?? new Error("No Solana RPC endpoint could serve signature history");
}
