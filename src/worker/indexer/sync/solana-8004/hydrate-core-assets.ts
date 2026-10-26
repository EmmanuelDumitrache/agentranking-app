import { deserializeAssetV1 } from "@metaplex-foundation/mpl-core";
import { lamports, publicKey } from "@metaplex-foundation/umi";
import { mapWithConcurrency } from "@/lib/async-pool";
import {
  MPL_CORE_PROGRAM_ID,
  SOLANA_RPC_ACCOUNT_BATCH_CONCURRENCY,
  SOLANA_RPC_ACCOUNT_BATCH_SIZE,
} from "./constants.js";
import { solanaRpcCall, type Solana8004RpcEndpoint, type SolanaRpcAccount } from "./rpc-client.js";

export type DecodedCoreAsset = ReturnType<typeof deserializeAssetV1>;
export type CoreAssetHydrationResult = {
  proofs: Map<string, DecodedCoreAsset>;
  terminalRejectCount: number;
  contextSlot: bigint;
};

type MultipleAccountsResult = { context: { slot: number }; value: Array<SolanaRpcAccount | null> };

function canonicalBase64(value: unknown, address: string): Uint8Array {
  if (typeof value !== "string" || !value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`Core asset ${address} returned malformed base64 data`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(`Core asset ${address} returned non-canonical base64 data`);
  return decoded;
}

export async function hydrateSolana8004CoreAssets(input: {
  endpoint: Solana8004RpcEndpoint;
  assetAddresses: string[];
  minContextSlot: bigint;
  signal?: AbortSignal;
}): Promise<CoreAssetHydrationResult> {
  if (input.minContextSlot > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Core hydration minContextSlot exceeds JavaScript safe integer range");
  const batchCount = Math.ceil(input.assetAddresses.length / SOLANA_RPC_ACCOUNT_BATCH_SIZE);
  const batches = await mapWithConcurrency(
    Array.from({ length: batchCount }, (_, index) => index * SOLANA_RPC_ACCOUNT_BATCH_SIZE),
    SOLANA_RPC_ACCOUNT_BATCH_CONCURRENCY,
    async (offset) => {
      const addresses = input.assetAddresses.slice(offset, offset + SOLANA_RPC_ACCOUNT_BATCH_SIZE);
      const result = await solanaRpcCall<MultipleAccountsResult>(input.endpoint, "getMultipleAccounts", [
        addresses,
        { commitment: "finalized", encoding: "base64", minContextSlot: Number(input.minContextSlot) },
      ], input.signal, 64 * 1024 * 1024);
      if (!Number.isSafeInteger(result.context?.slot) || BigInt(result.context.slot) < input.minContextSlot) {
        throw new Error(`Core getMultipleAccounts returned context slot ${String(result.context?.slot)} below ${input.minContextSlot}`);
      }
      if (!Array.isArray(result.value) || result.value.length !== addresses.length) {
        throw new Error(`Core getMultipleAccounts returned ${Array.isArray(result.value) ? result.value.length : "no"} accounts for ${addresses.length} addresses`);
      }
      const proofs: Array<readonly [string, DecodedCoreAsset]> = [];
      let terminalRejectCount = 0;
      for (let index = 0; index < addresses.length; index += 1) {
        const address = addresses[index]!;
        const account = result.value[index];
        try {
          if (!account) throw new Error("Core asset account is missing");
          if (account.owner !== MPL_CORE_PROGRAM_ID) throw new Error(`Core asset owner ${account.owner} does not match ${MPL_CORE_PROGRAM_ID}`);
          if (!Number.isSafeInteger(account.lamports) || account.lamports < 0) throw new Error("Core asset returned invalid lamports");
          if (!Array.isArray(account.data) || account.data[1] !== "base64") throw new Error("Core asset did not return base64 data");
          const rpcAccount = {
            exists: true,
            publicKey: publicKey(address),
            owner: publicKey(account.owner),
            executable: account.executable === true,
            lamports: lamports(account.lamports),
            data: canonicalBase64(account.data[0], address),
          } as Parameters<typeof deserializeAssetV1>[0];
          proofs.push([address, deserializeAssetV1(rpcAccount)] as const);
        } catch {
          terminalRejectCount++;
        }
      }
      return { proofs, terminalRejectCount, contextSlot: BigInt(result.context.slot) };
    },
  );
  const proofs = new Map<string, DecodedCoreAsset>();
  let terminalRejectCount = 0;
  let contextSlot = input.minContextSlot;
  for (const batch of batches) {
    for (const [address, proof] of batch.proofs) proofs.set(address, proof);
    terminalRejectCount += batch.terminalRejectCount;
    if (batch.contextSlot > contextSlot) contextSlot = batch.contextSlot;
  }
  return { proofs, terminalRejectCount, contextSlot };
}
