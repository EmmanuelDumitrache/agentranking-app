import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { deserializeAssetV1 } from "@metaplex-foundation/mpl-core";
import { lamports, publicKey } from "@metaplex-foundation/umi";
import { resolveMetaplexRpcUrl } from "@/lib/metaplex/rpc-config";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { deadlineSignal, throwIfAborted } from "@/lib/abort";
export const MPL_CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
export type DecodedCoreAsset = ReturnType<typeof deserializeAssetV1>;
export type CoreAssetHydrationResult = {
  assets: Map<string, DecodedCoreAsset>;
  terminalRejects: Map<string, string>;
  contextSlot: bigint;
};

const RpcAccountSchema = z.object({
  data: z.tuple([z.string(), z.literal("base64")]),
  executable: z.boolean(),
  lamports: z.number().int().nonnegative(),
  owner: z.string(),
  rentEpoch: z.number().optional(),
  space: z.number().optional(),
});

export type RpcAccount = z.infer<typeof RpcAccountSchema>;

const GetMultipleAccountsResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.unknown().optional(),
  error: z.object({ code: z.number().optional(), message: z.string().optional() }).optional(),
  result: z.object({
    context: z.object({ slot: z.number().optional() }).optional(),
    value: z.array(RpcAccountSchema.nullable()).optional(),
  }).optional(),
});

export type GetMultipleAccountsResponse = z.infer<typeof GetMultipleAccountsResponseSchema>;
const MIN_CONTEXT_SLOT_RETRY_DELAYS_MS = [500, 1_000, 2_000] as const;
function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) out.push(values.slice(offset, offset + size));
  return out;
}
function decodeCanonicalBase64(value: unknown, address: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`Core asset ${address} returned malformed base64 data`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error(`Core asset ${address} returned non-canonical base64 data`);
  }
  return Uint8Array.from(decoded);
}
/**
 * Hydrates current MPL Core accounts through standard Solana RPC.
 *
 * The RPC context must be at least the supplied discovery slot, and every
 * non-null account must still be owned by the MPL Core program. DAS is never
 * accepted as a substitute for these protocol-level checks.
 */
export async function hydrateCoreAssetsRpc(
  assetAddresses: string[],
  minContextSlot: bigint,
  signal?: AbortSignal,
): Promise<CoreAssetHydrationResult> {
  const assets = new Map<string, DecodedCoreAsset>();
  const terminalRejects = new Map<string, string>();
  if (assetAddresses.length === 0) return { assets, terminalRejects, contextSlot: minContextSlot };
  if (minContextSlot < 0n || minContextSlot > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid Metaplex hydration minContextSlot ${minContextSlot}`);
  }
  const rpcUrl = resolveMetaplexRpcUrl();
  let highestContextSlot = minContextSlot;
  for (const addresses of chunks(assetAddresses, 100)) {
    throwIfAborted(signal);
    let json: GetMultipleAccountsResponse;
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: deadlineSignal(30_000, signal),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "metaplex-core-assets",
          method: "getMultipleAccounts",
          params: [
            addresses,
            {
              commitment: "finalized",
              encoding: "base64",
              minContextSlot: Number(minContextSlot),
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`getMultipleAccounts HTTP ${response.status}`);
      json = await parseBoundedJsonBody(response, GetMultipleAccountsResponseSchema, 32 * 1024 * 1024);
      if (!json.error) break;
      const errorMessage = json.error.message ?? `getMultipleAccounts failed with code ${json.error.code ?? "unknown"}`;
      const retryDelayMs = MIN_CONTEXT_SLOT_RETRY_DELAYS_MS[attempt];
      if (
        retryDelayMs != null
        && /minimum context slot has not been reached/i.test(errorMessage)
      ) {
        // Discovery and hydration may land on different replicas of the same
        // RPC service. Give a lagging finalized replica a short bounded window
        // to reach the discovery context instead of failing the whole snapshot.
        await delay(retryDelayMs, undefined, { signal });
        continue;
      }
      throw new Error(errorMessage);
    }
    const contextSlot = json.result?.context?.slot;
    const values = json.result?.value;
    if (!Number.isSafeInteger(contextSlot) || (contextSlot ?? -1) < Number(minContextSlot)) {
      throw new Error(`getMultipleAccounts returned context slot ${String(contextSlot)} below ${minContextSlot}`);
    }
    if (!Array.isArray(values) || values.length !== addresses.length) {
      throw new Error(`getMultipleAccounts returned ${Array.isArray(values) ? values.length : "no"} accounts for ${addresses.length} addresses`);
    }
    const contextBigInt = BigInt(contextSlot!);
    if (contextBigInt > highestContextSlot) highestContextSlot = contextBigInt;
    for (let index = 0; index < addresses.length; index += 1) {
      const address = addresses[index]!;
      const account = values[index];
      try {
        if (account == null) throw new Error(`Core asset ${address} is missing at finalized context slot ${contextSlot}`);
        if (account.owner !== MPL_CORE_PROGRAM_ID) {
          throw new Error(`Core asset ${address} is owned by ${account.owner}, expected ${MPL_CORE_PROGRAM_ID}`);
        }
        const rpcAccount = {
          exists: true,
          publicKey: publicKey(address),
          owner: publicKey(account.owner),
          executable: account.executable,
          lamports: lamports(account.lamports),
          data: decodeCanonicalBase64(account.data[0], address),
        } as Parameters<typeof deserializeAssetV1>[0];
        assets.set(address, deserializeAssetV1(rpcAccount));
      } catch (error) {
        terminalRejects.set(address, error instanceof Error ? error.message : String(error));
      }
    }
  }
  throwIfAborted(signal);
  return { assets, terminalRejects, contextSlot: highestContextSlot };
}
