import "server-only";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { getAgentLaunchConnection } from "@/lib/agent-launch/solana";
export async function serializeAgentLaunchTransaction(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
): Promise<string> {
  const connection = getAgentLaunchConnection();
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  for (const ix of instructions) tx.add(ix);
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  return Buffer.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString("base64");
}
export async function getSolBalanceLamports(address: PublicKey): Promise<bigint> {
  const connection = getAgentLaunchConnection();
  return BigInt(await connection.getBalance(address, "confirmed"));
}