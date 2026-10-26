import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import {
  getAgentIdentityV1Size,
  getAgentIdentityV2Size,
} from "@metaplex-foundation/mpl-agent-registry";
import { resolveMetaplexRpcUrl } from "@/lib/metaplex/rpc-config";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { deadlineSignal } from "@/lib/abort";
export const MPL_AGENT_IDENTITY_PROGRAM_ID = "1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p";
export type DiscoveredMetaplexIdentity = {
  assetAddress: string;
  identityPda: string;
  identityVersion: 1 | 2;
  sourceSlot: bigint;
};
export type MetaplexDiscoverySnapshot = {
  items: DiscoveredMetaplexIdentity[];
  v1ContextSlot: bigint;
  v2ContextSlot: bigint;
  coverageSlot: bigint;
};

const ProgramAccountsResponseSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.unknown().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  result: z.object({
    context: z.object({ slot: z.number().int().nonnegative() }),
    value: z.array(z.object({
      pubkey: z.string(),
      account: z.object({
        data: z.tuple([z.string(), z.literal("base64")]),
      }),
    })),
  }).optional(),
});
async function fetchIdentityAssets(
  size: number,
  keyByte: number,
  identityVersion: 1 | 2,
  signal?: AbortSignal,
): Promise<{ contextSlot: bigint; items: DiscoveredMetaplexIdentity[] }> {
  const rpc = resolveMetaplexRpcUrl();
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: deadlineSignal(30_000, signal),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `metaplex-identities-v${identityVersion}`,
      method: "getProgramAccounts",
      params: [
        MPL_AGENT_IDENTITY_PROGRAM_ID,
        {
          commitment: "finalized",
          withContext: true,
          encoding: "base64",
          sortResults: true,
          dataSlice: { offset: 0, length: 40 },
          filters: [
            { dataSize: size },
            { memcmp: { offset: 0, bytes: bs58.encode(Buffer.from([keyByte])) } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`getProgramAccounts HTTP ${res.status}`);
  const json = await parseBoundedJsonBody(res, ProgramAccountsResponseSchema, 128 * 1024 * 1024);
  if (json.error) throw new Error(json.error.message ?? "getProgramAccounts failed");
  if (!json.result) throw new Error("getProgramAccounts returned no result");
  const sourceSlot = BigInt(json.result.context.slot);
  return {
    contextSlot: sourceSlot,
    items: json.result.value.map((row) => {
      try {
        new PublicKey(row.pubkey);
      } catch {
        throw new Error(`Identity account pubkey ${row.pubkey} is invalid`);
      }
      const encoded = row.account.data[0];
      if (typeof encoded !== "string" || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error(`Identity account ${row.pubkey} returned malformed base64`);
      }
      const data = Buffer.from(encoded, "base64");
      if (data.toString("base64") !== encoded) {
        throw new Error(`Identity account ${row.pubkey} returned non-canonical base64`);
      }
      if (data.byteLength < 40) throw new Error(`Identity account ${row.pubkey} is truncated`);
      if (data[0] !== keyByte) {
        throw new Error(`Identity account ${row.pubkey} discriminator does not match V${identityVersion}`);
      }
      return {
        identityPda: row.pubkey,
        assetAddress: bs58.encode(data.subarray(8, 40)),
        identityVersion,
        sourceSlot,
      };
    }),
  };
}
export function mergeMetaplexIdentitySnapshots(
  v1: { contextSlot: bigint; items: DiscoveredMetaplexIdentity[] },
  v2: { contextSlot: bigint; items: DiscoveredMetaplexIdentity[] },
): MetaplexDiscoverySnapshot {
  const byAsset = new Map<string, DiscoveredMetaplexIdentity>();
  const assetByIdentityPda = new Map<string, string>();
  const recordIdentityPda = (row: DiscoveredMetaplexIdentity): void => {
    const priorAsset = assetByIdentityPda.get(row.identityPda);
    if (priorAsset && priorAsset !== row.assetAddress) {
      throw new Error(`Metaplex identity PDA ${row.identityPda} maps to multiple assets (${priorAsset}, ${row.assetAddress})`);
    }
    assetByIdentityPda.set(row.identityPda, row.assetAddress);
  };
  for (const row of v1.items) {
    recordIdentityPda(row);
    const duplicate = byAsset.get(row.assetAddress);
    if (duplicate) {
      throw new Error(`Metaplex V1 inventory contains a duplicate identity row for asset ${row.assetAddress}`);
    }
    byAsset.set(row.assetAddress, row);
  }
  // V2 is the canonical representation when both account versions exist.
  const v2Assets = new Set<string>();
  for (const row of v2.items) {
    recordIdentityPda(row);
    if (v2Assets.has(row.assetAddress)) {
      throw new Error(`Metaplex V2 inventory contains a duplicate identity row for asset ${row.assetAddress}`);
    }
    v2Assets.add(row.assetAddress);
    byAsset.set(row.assetAddress, row);
  }
  return {
    items: [...byAsset.values()],
    v1ContextSlot: v1.contextSlot,
    v2ContextSlot: v2.contextSlot,
    coverageSlot: v1.contextSlot < v2.contextSlot ? v1.contextSlot : v2.contextSlot,
  };
}
/** Complete current Metaplex AgentIdentity inventory from the two program-owned account layouts. */
export async function discoverAllMetaplexIdentityAssets(signal?: AbortSignal): Promise<MetaplexDiscoverySnapshot> {
  const [v1, v2] = await Promise.all([
    fetchIdentityAssets(getAgentIdentityV1Size(), 1, 1, signal),
    fetchIdentityAssets(getAgentIdentityV2Size(), 2, 2, signal),
  ]);
  return mergeMetaplexIdentitySnapshots(v1, v2);
}
