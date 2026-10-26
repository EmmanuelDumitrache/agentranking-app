import { createHash } from "node:crypto";
import { getOrLoadValkeyJson } from "@/lib/valkey-cache";
import { valkeyGetString, valkeyIncrement } from "@/lib/valkey";
import { prisma } from "../db.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import { config } from "../config.js";
import { SOLANA_8004_IDENTITY_SOURCE_KEY, SOLANA_8004_TRUST_SOURCE_KEY } from "../sync/solana-current-state-types.js";
export { SOLANA_8004_IDENTITY_SOURCE_KEY, SOLANA_8004_TRUST_SOURCE_KEY };
import { getSyncableChainIds } from "../sync/rpc.js";
import { currentEvmSourceDescriptor } from "../lib/source-descriptor.js";
import { WORKER_CONFIGURATION_GENERATION } from "../lib/source-cursor.js";
import { WORKER_SEMANTIC_GENERATION } from "./semantic-generation.js";
export const INDEXER_BOOTSTRAP_PHASES = [
  "IDENTITY",
  "METADATA",
  "TRUST",
  "DERIVED",
  "STEADY",
] as const;
export type IndexerBootstrapPhase = (typeof INDEXER_BOOTSTRAP_PHASES)[number];
export type BootstrapExecutionState = {
  epochId: string | null;
  phase: IndexerBootstrapPhase;
  topologyHash: string;
  strict: boolean;
  provisional: boolean;
};
const CACHE_TTL_SECONDS = 1;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1_000;
const CACHE_GENERATION_KEY = "indexer:bootstrap-state:v2:generation";
let topologyHashCache: string | null = null;
let generationCache: { value: number; expiresAt: number } | null = null;
let generationLoad: Promise<number> | null = null;
let executionStateCache: { key: string; value: BootstrapExecutionState; expiresAt: number } | null = null;
let executionStateLoad: { key: string; promise: Promise<BootstrapExecutionState> } | null = null;
export const METAPLEX_IDENTITY_SOURCE_KEY = "solana:metaplex-agent-registry:identity";
export const REGISTRATION_METADATA_SOURCE_KEY = "metadata:registration-documents";
export const DERIVED_SCORE_SOURCE_KEY = "derived:score-and-read-models";
export function bootstrapTopologyHash(): string {
  if (topologyHashCache) return topologyHashCache;
  const chainIds = getSyncableChainIds()
    .filter((chainId) => chainId !== SOLANA_CHAIN_ID)
    .sort((a, b) => a - b);
  const evmSources = chainIds.flatMap((chainId) =>
    (["identity", "reputation", "validation"] as const).map((domain) => {
      const source = currentEvmSourceDescriptor(chainId, domain);
      return {
        chainId,
        domain,
        registryAddress: source.registryAddress.toLowerCase(),
        registryGeneration: source.registryGeneration,
      };
    }),
  );
  const material = {
    semanticGeneration: WORKER_SEMANTIC_GENERATION,
    configurationGeneration: WORKER_CONFIGURATION_GENERATION,
    topologyGeneration: process.env.INDEXER_BOOTSTRAP_TOPOLOGY_GENERATION?.trim() || "bootstrap-topology-v1",
    evmSources,
    solana8004ProgramId: config.solana8004ProgramId,
    solana8004IdlHash: config.solana8004IdlSha256,
    metaplexRegistryProgramId: process.env.METAPLEX_AGENT_REGISTRY_PROGRAM_ID?.trim() || null,
  };
  topologyHashCache = createHash("sha256").update(JSON.stringify(material)).digest("hex");
  return topologyHashCache;
}
function isBootstrapPhase(value: unknown): value is IndexerBootstrapPhase {
  return typeof value === "string" && INDEXER_BOOTSTRAP_PHASES.includes(value as IndexerBootstrapPhase);
}
function validatorForTopology(topologyHash: string) {
  return (candidate: unknown): candidate is BootstrapExecutionState => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const value = candidate as Partial<BootstrapExecutionState>;
    return (value.epochId === null || typeof value.epochId === "string")
      && isBootstrapPhase(value.phase)
      && value.topologyHash === topologyHash
      && typeof value.strict === "boolean"
      && typeof value.provisional === "boolean";
  };
}
async function currentGeneration(): Promise<number> {
  const now = Date.now();
  if (generationCache && generationCache.expiresAt > now) return generationCache.value;
  if (generationLoad) return generationLoad;
  const pending = (async () => {
    const raw = await valkeyGetString(CACHE_GENERATION_KEY);
    const parsed = raw === null ? 0 : Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error("Bootstrap-state Valkey generation is invalid");
    }
    generationCache = { value: parsed, expiresAt: Date.now() + CACHE_TTL_MS };
    return parsed;
  })();
  generationLoad = pending;
  try {
    return await pending;
  } finally {
    if (generationLoad === pending) generationLoad = null;
  }
}
export async function invalidateBootstrapStateCache(): Promise<void> {
  const generation = await valkeyIncrement(CACHE_GENERATION_KEY);
  generationCache = { value: generation, expiresAt: Date.now() + CACHE_TTL_MS };
  executionStateCache = null;
}
async function loadBootstrapExecutionState(topologyHash: string): Promise<BootstrapExecutionState> {
  const active = await prisma.indexerBootstrapEpoch.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
    select: { id: true, phase: true, topologyHash: true, strict: true },
  });
  if (active?.topologyHash === topologyHash) {
    return {
      epochId: active.id,
      phase: active.phase,
      topologyHash,
      strict: active.strict,
      provisional: false,
    };
  }
  if (active) {
    return {
      epochId: null,
      phase: "IDENTITY",
      topologyHash,
      strict: true,
      provisional: true,
    };
  }
  // Before the singleton coordinator creates the first epoch, an empty database must fail
  // closed to identity-only work. Populated installations preserve steady-state behavior.
  const agent = await prisma.agent.findFirst({ select: { id: true } });
  return {
    epochId: null,
    phase: agent ? "STEADY" : "IDENTITY",
    topologyHash,
    strict: process.env.INDEXER_BOOTSTRAP_STRICT === "1",
    provisional: true,
  };
}
export async function getBootstrapExecutionState(): Promise<BootstrapExecutionState> {
  const topologyHash = bootstrapTopologyHash();
  const generation = await currentGeneration();
  const key = `indexer:bootstrap-state:v2:${topologyHash}:g${generation}`;
  const now = Date.now();
  if (executionStateCache?.key === key && executionStateCache.expiresAt > now) {
    return executionStateCache.value;
  }
  if (executionStateLoad?.key === key) return executionStateLoad.promise;
  const pending = getOrLoadValkeyJson({
    key,
    ttlSeconds: CACHE_TTL_SECONDS,
    validate: validatorForTopology(topologyHash),
    leaseTtlMs: 10_000,
    waitMs: 5_000,
    load: () => loadBootstrapExecutionState(topologyHash),
  }).then((value) => {
    if (generationCache?.value === generation) {
      executionStateCache = { key, value, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    return value;
  });
  const load = { key, promise: pending };
  executionStateLoad = load;
  try {
    return await pending;
  } finally {
    if (executionStateLoad === load) executionStateLoad = null;
  }
}
export async function isBootstrapPhaseOpen(required: IndexerBootstrapPhase): Promise<boolean> {
  const state = await getBootstrapExecutionState();
  return state.phase === "STEADY" || state.phase === required;
}
export function nextBootstrapPhase(phase: IndexerBootstrapPhase): IndexerBootstrapPhase {
  const index = INDEXER_BOOTSTRAP_PHASES.indexOf(phase);
  return INDEXER_BOOTSTRAP_PHASES[Math.min(INDEXER_BOOTSTRAP_PHASES.length - 1, index + 1)]!;
}
