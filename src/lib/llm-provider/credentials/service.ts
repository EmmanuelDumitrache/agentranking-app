import "server-only";

import { prisma } from "@/lib/db";
import type { AgentChatModelDefinition } from "@/features/agent-chat/shared/model-registry-types";
import type {
  LlmProviderCredentialStatus,
  LlmProviderCredentialsResponse,
} from "@/lib/llm-provider/credential-contracts";
import {
  decryptProviderCredential,
  displayCredentialFingerprint,
  encryptProviderCredential,
  fingerprintProviderCredential,
} from "./crypto";
import {
  getProviderCredentialAdapter,
  listProviderCredentialAdapters,
  listProviderCredentialDescriptors,
  type ProviderModelRuntime,
} from "./provider-registry";
import { mapWithConcurrency } from "@/lib/async-pool";
import {
  ProviderCredentialCircuitOpenError,
  withProviderCredentialCircuit,
} from "./circuit-breaker";
import {
  getExternalProviderCached,
  writeExternalProviderCache,
} from "@/lib/external-provider-cache";
import {
  createProviderRuntimeFailure,
  isProviderRuntimeFailure,
  type ProviderRuntimeFailure,
} from "@/lib/llm-provider/provider-failure";
import { providerCircuitKey } from "./provider-http";

const MODEL_CACHE_FRESH_SECONDS = 5 * 60;
const MODEL_CACHE_STALE_SECONDS = 24 * 60 * 60;
const MODEL_CACHE_MAX_BYTES = 2 * 1024 * 1024;
const LAST_USED_WRITE_INTERVAL_MS = 10 * 60 * 1_000;

type SubmittedCredentialCatalog = {
  models: AgentChatModelDefinition[];
  freshness: "fresh" | "stale" | "unavailable";
  fetchedAt: string | null;
  failure: ProviderRuntimeFailure | null;
};

function catalogCacheKey(provider: string, fingerprint: string): string {
  return `byok-model-catalog:v2:${provider}:${fingerprint}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCachedModelList(value: unknown): value is AgentChatModelDefinition[] {
  return Array.isArray(value)
    && value.length <= 20_000
    && value.every((model) =>
      isRecord(model)
      && typeof model.modelKey === "string"
      && typeof model.providerModelId === "string"
      && typeof model.provider === "string"
      && typeof model.contextWindowTokens === "number"
      && typeof model.providerMaxOutputTokens === "number"
      && typeof model.maxOutputTokens === "number"
      && isRecord(model.capabilities)
      && isRecord(model.pricing),
    );
}

function nonSecretMetadataModelCount(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).modelCount;
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function rowToStatus(row: {
  provider: string;
  fingerprint: string;
  validationStatus: string;
  validatedAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  metadata: unknown;
}): LlmProviderCredentialStatus {
  const state: LlmProviderCredentialStatus["state"] = row.revokedAt
    ? "revoked"
    : row.validationStatus === "valid"
      ? "valid"
      : row.validationStatus === "invalid"
        ? "invalid"
        : row.validationStatus === "temporarily_unavailable"
          ? "temporarily_unavailable"
          : "disconnected";
  return {
    provider: row.provider,
    state,
    fingerprint: row.fingerprint ? displayCredentialFingerprint(row.fingerprint) : null,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    modelCount: nonSecretMetadataModelCount(row.metadata),
  };
}

export async function getProviderCredentialSettings(
  appAccountId: string,
): Promise<LlmProviderCredentialsResponse> {
  const providers = listProviderCredentialDescriptors();
  const rows = await prisma.llmProviderCredential.findMany({
    where: { appAccountId },
    orderBy: { provider: "asc" },
    select: {
      provider: true,
      fingerprint: true,
      validationStatus: true,
      validatedAt: true,
      lastUsedAt: true,
      revokedAt: true,
      metadata: true,
    },
  });
  const rowByProvider = new Map(rows.map((row) => [row.provider, row] as const));
  const credentials = providers.map((provider): LlmProviderCredentialStatus => {
    const row = rowByProvider.get(provider.id);
    return row
      ? rowToStatus(row)
      : {
          provider: provider.id,
          state: "disconnected",
          fingerprint: null,
          validatedAt: null,
          lastUsedAt: null,
          revokedAt: null,
          modelCount: null,
        };
  });
  return {
    providers,
    credentials,
    connectedProviderCount: credentials.filter((credential) => credential.state === "valid").length,
  };
}

async function loadCatalogWithCircuit(input: {
  provider: string;
  fingerprint: string;
  secret: string;
  signal?: AbortSignal;
}): Promise<AgentChatModelDefinition[]> {
  const adapter = getProviderCredentialAdapter(input.provider);
  if (!adapter) return [];
  try {
    return await withProviderCredentialCircuit({
      key: providerCircuitKey({
        provider: input.provider,
        credentialFingerprint: input.fingerprint,
        operation: "catalog",
      }),
      operation: () => adapter.listModels(input.secret, input.signal),
      isTransientFailure: (error) =>
        !input.signal?.aborted
        && isProviderRuntimeFailure(error)
        && error.retryable,
    });
  } catch (error) {
    if (error instanceof ProviderCredentialCircuitOpenError) {
      throw createProviderRuntimeFailure({
        provider: input.provider,
        source: "catalog",
        kind: "provider_unavailable",
        retryAfterMs: error.retryAfterMs,
        providerMessage: "Provider credential catalog circuit is temporarily open",
        cause: error,
      });
    }
    throw error;
  }
}

function catalogFailureRetainsCredential(
  error: ProviderRuntimeFailure,
): boolean {
  return error.credentialDisposition !== "invalidate"
    && error.kind !== "cancelled";
}

async function catalogForSubmittedCredential(input: {
  provider: string;
  fingerprint: string;
  secret: string;
  signal?: AbortSignal;
}): Promise<SubmittedCredentialCatalog> {
  const key = catalogCacheKey(input.provider, input.fingerprint);
  try {
    const cached = await getExternalProviderCached({
      key,
      validate: isCachedModelList,
      freshTtlSeconds: MODEL_CACHE_FRESH_SECONDS,
      staleTtlSeconds: MODEL_CACHE_STALE_SECONDS,
      maxPayloadBytes: MODEL_CACHE_MAX_BYTES,
      signal: input.signal,
      load: (cacheSignal) => loadCatalogWithCircuit({
        provider: input.provider,
        fingerprint: input.fingerprint,
        secret: input.secret,
        signal: input.signal
          ? AbortSignal.any([cacheSignal, input.signal])
          : cacheSignal,
      }),
      shouldUseStaleOnLoadError: (error) =>
        isProviderRuntimeFailure(error)
          ? catalogFailureRetainsCredential(error)
          : true,
    });
    return {
      models: cached.value,
      freshness: cached.status,
      fetchedAt: cached.fetchedAt,
      failure: null,
    };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (isProviderRuntimeFailure(error)) {
      if (!catalogFailureRetainsCredential(error)) throw error;
      return {
        models: [],
        freshness: "unavailable",
        fetchedAt: null,
        failure: error,
      };
    }

    // Distributed cache availability must not become a credential-validation
    // dependency. Fall back to the provider directly; a later normal catalog
    // read can repopulate Valkey once coordination is healthy again.
    try {
      const models = await loadCatalogWithCircuit(input);
      return {
        models,
        freshness: "fresh",
        fetchedAt: new Date().toISOString(),
        failure: null,
      };
    } catch (providerError) {
      if (isProviderRuntimeFailure(providerError)) {
        if (!catalogFailureRetainsCredential(providerError)) throw providerError;
        return {
          models: [],
          freshness: "unavailable",
          fetchedAt: null,
          failure: providerError,
        };
      }
      throw providerError;
    }
  }
}

function catalogFailureAuthenticatesCredential(
  failure: ProviderRuntimeFailure | null,
): boolean {
  if (!failure) return true;
  return [
    "permission",
    "billing",
    "rate_limit",
    "quota",
    "model_not_found",
    "request_invalid",
    "content_policy",
  ].includes(failure.kind);
}

export async function validateAndStoreProviderCredential(input: {
  appAccountId: string;
  provider: string;
  secret: string;
  signal?: AbortSignal;
}): Promise<LlmProviderCredentialStatus> {
  const provider = input.provider.trim().toLowerCase();
  const adapter = getProviderCredentialAdapter(provider);
  if (!adapter) throw new Error(`Unsupported LLM provider credential: ${provider}`);
  const secret = input.secret.trim();
  if (!secret || secret.length > 16_384) throw new Error("Invalid provider credential length");

  const fingerprint = fingerprintProviderCredential(provider, secret);
  const catalog = await catalogForSubmittedCredential({
    provider,
    fingerprint,
    secret,
    signal: input.signal,
  });
  const existing = await prisma.llmProviderCredential.findUnique({
    where: { appAccountId_provider: { appAccountId: input.appAccountId, provider } },
    select: { id: true },
  });
  const id = existing?.id ?? crypto.randomUUID();
  const ciphertext = encryptProviderCredential(secret, {
    credentialId: id,
    appAccountId: input.appAccountId,
    provider,
  });
  const now = new Date();
  const credentialValidated = catalogFailureAuthenticatesCredential(catalog.failure);
  const metadata = {
    modelCount: catalog.models.length,
    catalog: {
      status: catalog.freshness,
      fetchedAt: catalog.fetchedAt,
      checkedAt: now.toISOString(),
      failureKind: catalog.failure?.kind ?? null,
      statusCode: catalog.failure?.statusCode ?? null,
    },
  };
  const row = await prisma.llmProviderCredential.upsert({
    where: { appAccountId_provider: { appAccountId: input.appAccountId, provider } },
    create: {
      id,
      appAccountId: input.appAccountId,
      provider,
      ...ciphertext,
      fingerprint,
      validationStatus: "valid",
      validatedAt: credentialValidated ? now : null,
      revokedAt: null,
      metadata,
    },
    update: {
      ...ciphertext,
      fingerprint,
      validationStatus: "valid",
      ...(credentialValidated ? { validatedAt: now } : {}),
      revokedAt: null,
      metadata,
    },
    select: {
      provider: true,
      fingerprint: true,
      validationStatus: true,
      validatedAt: true,
      lastUsedAt: true,
      revokedAt: true,
      metadata: true,
    },
  });
  return rowToStatus(row);
}

export async function revokeProviderCredential(
  appAccountId: string,
  providerInput: string,
): Promise<void> {
  const provider = providerInput.trim().toLowerCase();
  const adapter = getProviderCredentialAdapter(provider);
  if (!adapter) throw new Error(`Unsupported LLM provider credential: ${provider}`);
  const row = await prisma.llmProviderCredential.findUnique({
    where: { appAccountId_provider: { appAccountId, provider } },
    select: { id: true },
  });
  if (!row) return;
  await prisma.llmProviderCredential.update({
    where: { id: row.id },
    data: {
      encryptedSecret: null,
      validationStatus: "revoked",
      revokedAt: new Date(),
      metadata: { modelCount: 0 },
    },
  });
}

type UsableCredential = {
  id: string;
  provider: string;
  secret: string;
  fingerprint: string;
  lastUsedAt: Date | null;
};

async function getUsableCredential(
  appAccountId: string,
  provider: string,
): Promise<UsableCredential | null> {
  const row = await prisma.llmProviderCredential.findUnique({
    where: { appAccountId_provider: { appAccountId, provider } },
    select: {
      id: true,
      appAccountId: true,
      provider: true,
      encryptedSecret: true,
      encryptionVersion: true,
      fingerprint: true,
      validationStatus: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });
  if (
    !row
    || row.revokedAt
    || row.validationStatus !== "valid"
    || !row.encryptedSecret
  ) {
    return null;
  }
  const secret = decryptProviderCredential(
    row.encryptedSecret,
    row.encryptionVersion,
    {
      credentialId: row.id,
      appAccountId: row.appAccountId,
      provider: row.provider,
    },
  );
  return {
    id: row.id,
    provider: row.provider,
    secret,
    fingerprint: row.fingerprint,
    lastUsedAt: row.lastUsedAt,
  };
}

function stampCatalogFreshness(
  models: readonly AgentChatModelDefinition[],
  status: "fresh" | "stale",
  fetchedAt: string,
): AgentChatModelDefinition[] {
  return models.map((model) => ({
    ...model,
    availability: "available" as const,
    catalogFreshness: status,
    catalogFetchedAt: fetchedAt,
  }));
}

async function markCredentialInvalidById(credentialId: string): Promise<void> {
  await prisma.llmProviderCredential.updateMany({
    where: { id: credentialId, validationStatus: "valid" },
    data: { validationStatus: "invalid", validatedAt: new Date() },
  });
}

async function modelsForCredential(
  credential: UsableCredential,
): Promise<AgentChatModelDefinition[]> {
  const adapter = getProviderCredentialAdapter(credential.provider);
  if (!adapter) return [];
  try {
    const cached = await getExternalProviderCached({
      key: catalogCacheKey(credential.provider, credential.fingerprint),
      validate: isCachedModelList,
      freshTtlSeconds: MODEL_CACHE_FRESH_SECONDS,
      staleTtlSeconds: MODEL_CACHE_STALE_SECONDS,
      maxPayloadBytes: MODEL_CACHE_MAX_BYTES,
      load: (signal) => loadCatalogWithCircuit({
        provider: credential.provider,
        fingerprint: credential.fingerprint,
        secret: credential.secret,
        signal,
      }),
      shouldUseStaleOnLoadError: (error) =>
        !(
          isProviderRuntimeFailure(error)
          && error.credentialDisposition === "invalidate"
        ),
    });
    return stampCatalogFreshness(cached.value, cached.status, cached.fetchedAt);
  } catch (error) {
    if (isProviderRuntimeFailure(error) && error.credentialDisposition === "invalidate") {
      await markCredentialInvalidById(credential.id);
      return [];
    }
    if (isProviderRuntimeFailure(error)) return [];

    // Cache coordination/publication errors are infrastructure failures, not
    // model-catalog failures. Read the provider directly so Valkey health never
    // decides whether an otherwise usable BYOK credential has models.
    try {
      const models = await loadCatalogWithCircuit({
        provider: credential.provider,
        fingerprint: credential.fingerprint,
        secret: credential.secret,
      });
      void writeExternalProviderCache({
        key: catalogCacheKey(credential.provider, credential.fingerprint),
        value: models,
        validate: isCachedModelList,
        freshTtlSeconds: MODEL_CACHE_FRESH_SECONDS,
        staleTtlSeconds: MODEL_CACHE_STALE_SECONDS,
        maxPayloadBytes: MODEL_CACHE_MAX_BYTES,
      }).catch((cacheError) => {
        console.warn("[llm-provider-credential] failed to publish direct catalog fallback", {
          provider: credential.provider,
          errorName: cacheError instanceof Error ? cacheError.name : "unknown",
        });
      });
      return stampCatalogFreshness(models, "fresh", new Date().toISOString());
    } catch (directError) {
      if (
        isProviderRuntimeFailure(directError)
        && directError.credentialDisposition === "invalidate"
      ) {
        await markCredentialInvalidById(credential.id);
        return [];
      }
      console.error("[llm-provider-credential] model discovery failed", {
        provider: credential.provider,
        errorName: directError instanceof Error ? directError.name : "unknown",
      });
      return [];
    }
  }
}

export async function getAccountByokModels(
  appAccountId: string,
): Promise<AgentChatModelDefinition[]> {
  const rows = await prisma.llmProviderCredential.findMany({
    where: {
      appAccountId,
      revokedAt: null,
      validationStatus: "valid",
      encryptedSecret: { not: null },
    },
    select: { provider: true },
  });
  const supported = new Set(listProviderCredentialAdapters().map((item) => item.descriptor.id));
  const modelGroups = await mapWithConcurrency(
    rows.filter((row) => supported.has(row.provider)),
    3,
    async (row) => {
      const credential = await getUsableCredential(appAccountId, row.provider);
      return credential ? modelsForCredential(credential) : [];
    },
  );
  return modelGroups.flat();
}

export async function resolveByokModel(
  appAccountId: string,
  modelKey: string,
): Promise<AgentChatModelDefinition | null> {
  if (!modelKey.startsWith("byok:")) return null;
  const second = modelKey.indexOf(":", 5);
  if (second < 0) return null;
  const provider = modelKey.slice(5, second);
  const encodedId = modelKey.slice(second + 1);
  let modelId: string;
  try {
    modelId = decodeURIComponent(encodedId);
  } catch {
    return null;
  }
  const credential = await getUsableCredential(appAccountId, provider);
  if (!credential) return null;
  const models = await modelsForCredential(credential);
  return models.find((model) => model.providerModelId === modelId) ?? null;
}

function touchCredentialLastUsed(credential: UsableCredential): void {
  const threshold = new Date(Date.now() - LAST_USED_WRITE_INTERVAL_MS);
  if (credential.lastUsedAt && credential.lastUsedAt >= threshold) return;
  void prisma.llmProviderCredential.updateMany({
    where: {
      id: credential.id,
      OR: [
        { lastUsedAt: null },
        { lastUsedAt: { lt: threshold } },
      ],
    },
    data: { lastUsedAt: new Date() },
  }).catch((error) => {
    console.warn("[llm-provider-credential] failed to update lastUsedAt", {
      provider: credential.provider,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  });
}

export type ProviderRuntimeResolution = ProviderModelRuntime & {
  provider: string;
  credentialId: string;
  credentialFingerprint: string;
};

export async function resolveByokRuntime(input: {
  appAccountId: string;
  model: AgentChatModelDefinition;
}): Promise<ProviderRuntimeResolution | null> {
  if (input.model.credentialSource !== "byok") return null;
  const provider = input.model.credentialProvider;
  if (!provider) return null;
  const adapter = getProviderCredentialAdapter(provider);
  if (!adapter) return null;
  const credential = await getUsableCredential(input.appAccountId, provider);
  if (!credential) return null;
  touchCredentialLastUsed(credential);
  return {
    ...adapter.createRuntime(
      input.model.providerModelId,
      credential.secret,
      {
        inferenceCircuitKey: providerCircuitKey({
          provider: credential.provider,
          credentialFingerprint: credential.fingerprint,
          operation: "inference",
        }),
      },
    ),
    provider,
    credentialId: credential.id,
    credentialFingerprint: credential.fingerprint,
  };
}

export async function resolveByokLanguageModel(input: {
  appAccountId: string;
  model: AgentChatModelDefinition;
}) {
  const runtime = await resolveByokRuntime(input);
  return runtime
    ? { languageModel: runtime.languageModel, provider: runtime.provider }
    : null;
}

export async function markByokCredentialInvalid(input: {
  appAccountId: string;
  model: AgentChatModelDefinition;
  failure?: ProviderRuntimeFailure;
}): Promise<void> {
  if (input.failure && input.failure.credentialDisposition !== "invalidate") return;
  const provider = input.model.credentialProvider;
  if (input.model.credentialSource !== "byok" || !provider) return;
  await prisma.llmProviderCredential.updateMany({
    where: {
      appAccountId: input.appAccountId,
      provider,
      validationStatus: "valid",
    },
    data: {
      validationStatus: "invalid",
      validatedAt: new Date(),
    },
  });
}
