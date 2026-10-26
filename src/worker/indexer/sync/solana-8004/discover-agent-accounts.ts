import { createHash } from "node:crypto";
import { SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR_BASE58 } from "./account-discriminators.js";
import { SOLANA_8004_INVENTORY_DATA_SLICE_BYTES } from "./constants.js";
import { solanaRpcCall, type Solana8004RpcEndpoint, type SolanaRpcAccount } from "./rpc-client.js";

export type Solana8004Inventory = {
  slot: bigint;
  accountPdas: string[];
  keyDigest: string;
};

type ProgramAccountsResult = {
  context: { slot: number };
  value: Array<{ pubkey: string; account: SolanaRpcAccount }>;
};

type ProgramAccountInventoryRows = {
  slot: bigint;
  rows: ProgramAccountsResult["value"];
};

function sortedInventoryKeyDigest(
  programId: string,
  genesisHash: string,
  sortedAccountPdas: readonly string[],
): string {
  const hash = createHash("sha256").update(programId).update("\0").update(genesisHash).update("\0");
  for (let index = 0; index < sortedAccountPdas.length; index += 1) {
    if (index > 0) hash.update("\n");
    hash.update(sortedAccountPdas[index]!);
  }
  return hash.digest("hex");
}

export function inventoryKeyDigest(programId: string, genesisHash: string, accountPdas: string[]): string {
  let alreadySorted = true;
  for (let index = 1; index < accountPdas.length; index += 1) {
    if (accountPdas[index - 1]! > accountPdas[index]!) {
      alreadySorted = false;
      break;
    }
  }
  return sortedInventoryKeyDigest(
    programId,
    genesisHash,
    alreadySorted ? accountPdas : [...accountPdas].sort(),
  );
}

async function fetchSolana8004AgentAccountRows(input: {
  endpoint: Solana8004RpcEndpoint;
  programId: string;
  minContextSlot?: bigint;
  signal?: AbortSignal;
}): Promise<ProgramAccountInventoryRows> {
  if (input.minContextSlot != null &&
    (input.minContextSlot < 0n || input.minContextSlot > BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new Error(`invalid getProgramAccounts minContextSlot ${input.minContextSlot.toString(10)}`);
  }
  const config = {
    commitment: "finalized",
    withContext: true,
    encoding: "base64",
    filters: [{ memcmp: { offset: 0, bytes: SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR_BASE58 } }],
    dataSlice: { offset: 0, length: SOLANA_8004_INVENTORY_DATA_SLICE_BYTES },
    sortResults: true,
    ...(input.minContextSlot == null ? {} : { minContextSlot: Number(input.minContextSlot) }),
  };
  const result = await solanaRpcCall<ProgramAccountsResult>(input.endpoint, "getProgramAccounts", [
    input.programId,
    config,
  ], input.signal, 128 * 1024 * 1024);
  if (!Number.isSafeInteger(result.context?.slot) || result.context.slot < 0) {
    throw new Error(`getProgramAccounts returned invalid context slot ${String(result.context?.slot)}`);
  }
  if (input.minContextSlot != null && BigInt(result.context.slot) < input.minContextSlot) {
    throw new Error(
      `getProgramAccounts context slot ${result.context.slot} is below requested minContextSlot ${input.minContextSlot.toString(10)}`,
    );
  }
  if (!Array.isArray(result.value)) throw new Error("getProgramAccounts returned no account inventory");
  return {
    slot: BigInt(result.context.slot),
    rows: result.value,
  };
}

export async function discoverSolana8004AgentAccounts(input: {
  endpoint: Solana8004RpcEndpoint;
  programId: string;
  minContextSlot?: bigint;
  signal?: AbortSignal;
}): Promise<Solana8004Inventory> {
  const inventory = await fetchSolana8004AgentAccountRows(input);
  const accountPdas = inventory.rows.map((row) => row.pubkey);
  let alreadySorted = true;
  for (let index = 1; index < accountPdas.length; index += 1) {
    if (accountPdas[index - 1]! > accountPdas[index]!) {
      alreadySorted = false;
      break;
    }
  }
  if (!alreadySorted) accountPdas.sort();
  for (let index = 1; index < accountPdas.length; index += 1) {
    if (accountPdas[index] === accountPdas[index - 1]) {
      throw new Error("getProgramAccounts returned duplicate AgentAccount addresses");
    }
  }
  return {
    slot: inventory.slot,
    accountPdas,
    keyDigest: sortedInventoryKeyDigest(input.programId, input.endpoint.genesisHash, accountPdas),
  };
}

export async function verifySolana8004AgentAccountInventory(input: {
  endpoint: Solana8004RpcEndpoint;
  programId: string;
  expectedAccountPdas: readonly string[];
  minContextSlot?: bigint;
  signal?: AbortSignal;
}): Promise<{ slot: bigint }> {
  const inventory = await fetchSolana8004AgentAccountRows(input);
  if (inventory.rows.length !== input.expectedAccountPdas.length) {
    throw new Error(
      `Solana 8004 inventory changed during snapshot (${input.expectedAccountPdas.length} -> ${inventory.rows.length} accounts)`,
    );
  }

  let exactOrderMatch = true;
  let alreadySorted = true;
  for (let index = 0; index < inventory.rows.length; index += 1) {
    const accountPda = inventory.rows[index]!.pubkey;
    if (accountPda !== input.expectedAccountPdas[index]) exactOrderMatch = false;
    if (index > 0 && inventory.rows[index - 1]!.pubkey > accountPda) alreadySorted = false;
  }
  if (exactOrderMatch) return { slot: inventory.slot };

  // RPCs that honor sortResults take the allocation-free branch above. Retain
  // compatibility with providers that ignore it by comparing the unsorted key
  // set in O(n), rather than sorting and hashing a second 100k-row inventory.
  if (!alreadySorted) {
    const returnedAccountPdas = new Set<string>();
    for (const row of inventory.rows) {
      if (!returnedAccountPdas.add(row.pubkey)) {
        throw new Error("getProgramAccounts returned duplicate AgentAccount addresses");
      }
    }
    let sameKeys = true;
    for (const accountPda of input.expectedAccountPdas) {
      if (!returnedAccountPdas.has(accountPda)) {
        sameKeys = false;
        break;
      }
    }
    if (sameKeys) return { slot: inventory.slot };
  }

  throw new Error("Solana 8004 inventory changed during snapshot");
}
