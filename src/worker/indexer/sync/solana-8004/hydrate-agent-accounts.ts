import { createHash } from "node:crypto";
import { mapWithConcurrency } from "@/lib/async-pool";
import { hasAgentAccountDiscriminator } from "./account-discriminators.js";
import { decodeSolana8004AgentAccount, type DecodedSolana8004AgentAccount } from "./decode-agent-account.js";
import { deriveSolana8004AgentPdaWithBump } from "./derive-agent-pda.js";
import {
  SOLANA_RPC_ACCOUNT_BATCH_CONCURRENCY,
  SOLANA_RPC_ACCOUNT_BATCH_SIZE,
} from "./constants.js";
import { solanaRpcCall, type Solana8004RpcEndpoint, type SolanaRpcAccount } from "./rpc-client.js";

export type HydratedSolana8004AgentAccount = {
  accountPda: string;
  decoded: DecodedSolana8004AgentAccount;
  evidenceDigest: string;
};

export type AgentAccountHydrationResult = {
  accounts: HydratedSolana8004AgentAccount[];
  terminalRejectCount: number;
  contextSlot: bigint;
};

type MultipleAccountsResult = { context: { slot: number }; value: Array<SolanaRpcAccount | null> };

function decodeBase64(account: SolanaRpcAccount, address: string): Uint8Array {
  if (!Array.isArray(account.data) || account.data[1] !== "base64") throw new Error(`${address} did not return base64 account data`);
  const value = account.data[0];
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${address} returned malformed base64 data`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error(`${address} returned non-canonical base64 data`);
  return bytes;
}

export async function hydrateSolana8004AgentAccounts(input: {
  endpoint: Solana8004RpcEndpoint;
  programId: string;
  accountPdas: string[];
  expectedCollection: string;
  minContextSlot: bigint;
  signal?: AbortSignal;
}): Promise<AgentAccountHydrationResult> {
  if (input.minContextSlot > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Solana minContextSlot exceeds JavaScript safe integer range");
  const batchCount = Math.ceil(input.accountPdas.length / SOLANA_RPC_ACCOUNT_BATCH_SIZE);
  const batches = await mapWithConcurrency(
    Array.from({ length: batchCount }, (_, index) => index * SOLANA_RPC_ACCOUNT_BATCH_SIZE),
    SOLANA_RPC_ACCOUNT_BATCH_CONCURRENCY,
    async (offset) => {
      const addresses = input.accountPdas.slice(offset, offset + SOLANA_RPC_ACCOUNT_BATCH_SIZE);
      const result = await solanaRpcCall<MultipleAccountsResult>(input.endpoint, "getMultipleAccounts", [
        addresses,
        { commitment: "finalized", encoding: "base64", minContextSlot: Number(input.minContextSlot) },
      ], input.signal, 64 * 1024 * 1024);
      if (!Number.isSafeInteger(result.context?.slot) || BigInt(result.context.slot) < input.minContextSlot) {
        throw new Error(`getMultipleAccounts returned context slot ${String(result.context?.slot)} below ${input.minContextSlot}`);
      }
      if (!Array.isArray(result.value) || result.value.length !== addresses.length) {
        throw new Error(`getMultipleAccounts returned ${Array.isArray(result.value) ? result.value.length : "no"} accounts for ${addresses.length} addresses`);
      }
      const accounts: HydratedSolana8004AgentAccount[] = [];
      let terminalRejectCount = 0;
      for (let index = 0; index < addresses.length; index += 1) {
        const accountPda = addresses[index]!;
        const account = result.value[index];
        try {
          if (!account) throw new Error("account disappeared after inventory discovery");
          if (account.owner !== input.programId) throw new Error(`account owner ${account.owner} does not match ${input.programId}`);
          const bytes = decodeBase64(account, accountPda);
          if (!hasAgentAccountDiscriminator(bytes)) throw new Error("account discriminator mismatch");
          const decoded = decodeSolana8004AgentAccount(bytes);
          if (decoded.collection !== input.expectedCollection) {
            throw new Error(`AgentAccount collection ${decoded.collection} does not match configured base collection ${input.expectedCollection}`);
          }
          const expectedPda = deriveSolana8004AgentPdaWithBump(decoded.asset, input.programId);
          if (expectedPda.address !== accountPda) {
            throw new Error(`derived PDA ${expectedPda.address} does not match discovered account`);
          }
          if (decoded.bump !== expectedPda.bump) {
            throw new Error(`AgentAccount bump ${decoded.bump} does not match derived bump ${expectedPda.bump}`);
          }
          // The raw account bytes are used only as immutable source evidence.
          // Retaining every Buffer beside the decoded 100k-account inventory can
          // double snapshot heap usage, so keep its fixed-size digest instead.
          accounts.push({
            accountPda,
            decoded,
            evidenceDigest: createHash("sha256").update(bytes).digest("hex"),
          });
        } catch {
          terminalRejectCount++;
        }
      }
      return { accounts, terminalRejectCount, contextSlot: BigInt(result.context.slot) };
    },
  );
  const accounts: HydratedSolana8004AgentAccount[] = [];
  let terminalRejectCount = 0;
  let contextSlot = input.minContextSlot;
  for (const batch of batches) {
    accounts.push(...batch.accounts);
    terminalRejectCount += batch.terminalRejectCount;
    if (batch.contextSlot > contextSlot) contextSlot = batch.contextSlot;
  }
  return { accounts, terminalRejectCount, contextSlot };
}
