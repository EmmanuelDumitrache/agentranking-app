import "server-only";
import { Keypair, Transaction } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { getAgentLaunchConnection } from "@/lib/agent-launch/solana";
import { decryptSecretBytes } from "@/lib/custodial-wallet/crypto";
type CustodialSecretRow = {
  encrypted_secret: string;
  public_key: string;
};
export async function loadAgentCustodialKeypair(agentDbId: number): Promise<Keypair | null> {
  const rows = await prisma.$queryRaw<CustodialSecretRow[]>`
    SELECT cw.encrypted_secret, cw.public_key
    FROM "Agent" a
    INNER JOIN custodial_wallets cw ON cw.id = a.agent_wallet_id
    WHERE a.id = ${agentDbId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.encrypted_secret) return null;
  const secret = decryptSecretBytes(row.encrypted_secret);
  return Keypair.fromSecretKey(secret);
}
export async function signAndSendAgentCustodialTransaction(input: {
  agentDbId: number;
  transactionBase64: string;
  mintSecretKey?: Uint8Array;
  expectedSignerPublicKey?: string;
}): Promise<string> {
  const keypair = await loadAgentCustodialKeypair(input.agentDbId);
  if (!keypair) {
    throw new Error("Agent wallet signing is not available for this agent.");
  }
  const signer = keypair.publicKey.toBase58();
  if (input.expectedSignerPublicKey && signer !== input.expectedSignerPublicKey.trim()) {
    throw new Error("Agent wallet does not match the launch draft creator wallet.");
  }
  const tx = Transaction.from(Buffer.from(input.transactionBase64, "base64"));
  tx.partialSign(keypair);
  if (input.mintSecretKey) {
    tx.partialSign(Keypair.fromSecretKey(input.mintSecretKey));
  }
  const connection = getAgentLaunchConnection();
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}
