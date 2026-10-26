import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { deadlineSignal, throwIfAborted } from "@/lib/abort";

const DasSingleResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

const DasBatchResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.unknown().optional(),
  result: z.array(z.unknown()).nullable().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});
export type DasAssetResult = {
  id: string;
  content?: {
    json_uri?: string;
    metadata?: { name?: string; description?: string };
  };
  ownership?: { owner?: string };
  authorities?: Array<{ address?: string; scopes?: string[] }>;
  plugins?: Record<string, unknown>;
  agent_uri?: string;
  agentUri?: string;
  registration_uri?: string;
  registrationUri?: string;
  asset_signer?: string;
  agent_token?: string;
  is_agent?: boolean;
};
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
function nonEmptyString(value: unknown, maxBytes = 4_096): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0") || hasUnpairedSurrogate(trimmed)) return null;
  return Buffer.byteLength(trimmed, "utf8") <= maxBytes ? trimmed : null;
}
function normalizedAgentIdentityPlugins(value: unknown): Record<string, unknown> | undefined {
  const plugins = record(value);
  if (!plugins) return undefined;
  const normalized: Record<string, unknown> = {};
  for (const [key, rawPlugin] of Object.entries(plugins).slice(0, 64)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!normalizedKey.includes("agentidentity")) continue;
    const plugin = record(rawPlugin);
    if (!plugin) continue;
    for (const uriKey of ["uri", "agent_uri", "agentUri", "registration_uri", "registrationUri"]) {
      const uri = nonEmptyString(plugin[uriKey], 4_096);
      if (uri) {
        const safeKey = key.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 256) || "agentIdentity";
        normalized[safeKey] = { uri };
        break;
      }
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
function normalizedDasAsset(value: unknown): DasAssetResult | null {
  const root = record(value);
  const id = nonEmptyString(root?.id, 128);
  if (!root || !id) return null;
  const content = record(root.content);
  const metadata = record(content?.metadata);
  const ownership = record(root.ownership);
  const plugins = normalizedAgentIdentityPlugins(root.plugins);
  const authorities = Array.isArray(root.authorities)
    ? root.authorities.slice(0, 64).flatMap((authority) => {
        const row = record(authority);
        const address = nonEmptyString(row?.address, 128);
        if (!address) return [];
        const scopes = Array.isArray(row?.scopes)
          ? row.scopes.flatMap((scope) => {
              const normalized = nonEmptyString(scope, 128);
              return normalized ? [normalized] : [];
            }).slice(0, 64)
          : undefined;
        return [{ address, ...(scopes && scopes.length > 0 ? { scopes } : {}) }];
      })
    : undefined;
  const jsonUri = nonEmptyString(content?.json_uri, 4_096);
  const name = nonEmptyString(metadata?.name, 1_024);
  const description = nonEmptyString(metadata?.description, 16_000);
  const owner = nonEmptyString(ownership?.owner, 128);
  const directAgentUri = nonEmptyString(root.agent_uri, 4_096);
  const directAgentUriCamel = nonEmptyString(root.agentUri, 4_096);
  const directRegistrationUri = nonEmptyString(root.registration_uri, 4_096);
  const directRegistrationUriCamel = nonEmptyString(root.registrationUri, 4_096);
  const assetSigner = nonEmptyString(root.asset_signer, 128);
  const agentToken = nonEmptyString(root.agent_token, 128);
  return {
    id,
    ...(jsonUri || name || description
      ? { content: {
          ...(jsonUri ? { json_uri: jsonUri } : {}),
          ...(name || description
            ? { metadata: {
                ...(name ? { name } : {}),
                ...(description ? { description } : {}),
              } }
            : {}),
        } }
      : {}),
    ...(owner ? { ownership: { owner } } : {}),
    ...(authorities && authorities.length > 0 ? { authorities } : {}),
    ...(plugins ? { plugins } : {}),
    ...(directAgentUri ? { agent_uri: directAgentUri } : {}),
    ...(directAgentUriCamel ? { agentUri: directAgentUriCamel } : {}),
    ...(directRegistrationUri ? { registration_uri: directRegistrationUri } : {}),
    ...(directRegistrationUriCamel ? { registrationUri: directRegistrationUriCamel } : {}),
    ...(assetSigner ? { asset_signer: assetSigner } : {}),
    ...(agentToken ? { agent_token: agentToken } : {}),
    ...(typeof root.is_agent === "boolean" ? { is_agent: root.is_agent } : {}),
  };
}
/**
 * Providers expose AgentIdentity plugin fields under slightly different DAS
 * extension keys. Only inspect agent-specific containers; never treat the
 * generic Core content URI as the registration document URI.
 */
export function extractDasAgentRegistrationUri(asset: DasAssetResult | null | undefined): string | null {
  if (!asset) return null;
  const root = asset as unknown as Record<string, unknown>;
  for (const key of ["agent_uri", "agentUri", "registration_uri", "registrationUri"]) {
    const direct = nonEmptyString(root[key]);
    if (direct) return direct;
  }
  const plugins = record(asset.plugins);
  if (!plugins) return null;
  for (const [key, value] of Object.entries(plugins)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!normalizedKey.includes("agentidentity")) continue;
    const plugin = record(value);
    if (!plugin) continue;
    for (const uriKey of ["uri", "agent_uri", "agentUri", "registration_uri", "registrationUri"]) {
      const uri = nonEmptyString(plugin[uriKey], 4_096);
      if (uri) return uri;
    }
  }
  return null;
}
export function resolveDasRpcUrl(): string | null {
  if (process.env.METAPLEX_DAS_ENABLED?.trim().toLowerCase() !== "true") return null;
  const configured = process.env.METAPLEX_DAS_URL?.trim();
  if (configured) return configured;
  const key = process.env.HELIUS_API_KEY?.trim();
  if (!key) return null;
  return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;
}
export function isDasEnabled(): boolean {
  return resolveDasRpcUrl() != null;
}
export async function fetchDasAsset(assetAddress: string, signal?: AbortSignal): Promise<DasAssetResult | null> {
  const rpcUrl = resolveDasRpcUrl();
  if (!rpcUrl) return null;
  const requestedId = assetAddress.trim();
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: deadlineSignal(12_000, signal),
      body: JSON.stringify({ jsonrpc: "2.0", id: "metaplex-das", method: "getAsset", params: { id: requestedId } }),
    });
    if (!res.ok) return null;
    const json = await parseBoundedJsonBody(res, DasSingleResponseSchema, 2 * 1024 * 1024);
    const result = normalizedDasAsset(json.result);
    if (json.error || result?.id !== requestedId) return null;
    return result;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return null;
  }
}
function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) out.push(values.slice(offset, offset + size));
  return out;
}
export async function fetchDasAssetBatch(assetAddresses: string[], signal?: AbortSignal): Promise<Map<string, DasAssetResult>> {
  const rpcUrl = resolveDasRpcUrl();
  if (!rpcUrl || assetAddresses.length === 0 || process.env.METAPLEX_DAS_BATCH_ENABLED === "false") return new Map();
  const configuredSize = Number.parseInt(process.env.METAPLEX_DAS_BATCH_SIZE ?? "1000", 10);
  const batchSize = Math.max(1, Math.min(1000, Number.isSafeInteger(configuredSize) ? configuredSize : 1000));
  const result = new Map<string, DasAssetResult>();
  for (const ids of chunks(assetAddresses, batchSize)) {
    throwIfAborted(signal);
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: deadlineSignal(30_000, signal),
      body: JSON.stringify({ jsonrpc: "2.0", id: "metaplex-agent-batch", method: "getAssetBatch", params: { ids } }),
    });
    if (!res.ok) throw new Error(`getAssetBatch HTTP ${res.status}`);
    const json = await parseBoundedJsonBody(res, DasBatchResponseSchema, 32 * 1024 * 1024);
    if (json.error) throw new Error(json.error.message ?? "getAssetBatch failed");
    if (json.result !== undefined && json.result !== null && !Array.isArray(json.result)) {
      throw new Error("getAssetBatch returned a non-array result");
    }
    const requestedIds = new Set(ids);
    for (const rawAsset of Array.isArray(json.result) ? json.result : []) {
      const asset = normalizedDasAsset(rawAsset);
      if (asset?.id && requestedIds.has(asset.id)) result.set(asset.id, asset);
    }
    throwIfAborted(signal);
  }
  return result;
}
