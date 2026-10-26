import "server-only";

import { createHash } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type AccountInfo,
  type Keypair,
} from "@solana/web3.js";
import {
  getAgentLaunchConnection,
  isSolanaRpcRateLimitedError,
  SOLANA_RPC_BUSY_MESSAGE,
  withAgentLaunchReadRpc,
} from "@/lib/agent-launch/solana";
import { AR_AGENT_IDENTITY_PROGRAM_ID } from "@/lib/agent-identity-registry/constants";
import { findArAgentIdentityPda } from "@/lib/agent-identity-registry/pda";

export type ArAgentIdentityRegistrationInput = {
  signer: Keypair;
  tokenMint: string;
  agentId: string;
  uri: string;
  imageUri: string;
  metadataUri: string;
};

export type ArAgentIdentityRegistrationResult = {
  identityPda: string;
  tokenMint: string;
  transactionSignature: string;
};

export type ArAgentIdentityPdaRead = {
  pda: string | null;
  rpcBusy: boolean;
};

const REGISTER_AGENT_IDENTITY_DISCRIMINATOR = Buffer.from([
  57, 31, 242, 205, 57, 129, 123, 35,
]);

function encodeBorshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

function sha256Bytes(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function buildRegisterInstruction(input: {
  authority: PublicKey;
  tokenMint: PublicKey;
  identityPda: PublicKey;
  agentId: string;
  uri: string;
  imageUri: string;
  metadataUri: string;
}): TransactionInstruction {
  const data = Buffer.concat([
    REGISTER_AGENT_IDENTITY_DISCRIMINATOR,
    encodeBorshString(input.agentId),
    encodeBorshString(input.uri),
    encodeBorshString(input.imageUri),
    encodeBorshString(input.metadataUri),
    sha256Bytes(input.imageUri),
    sha256Bytes(input.metadataUri),
  ]);

  return new TransactionInstruction({
    programId: new PublicKey(AR_AGENT_IDENTITY_PROGRAM_ID),
    keys: [
      { pubkey: input.authority, isSigner: true, isWritable: true },
      { pubkey: input.tokenMint, isSigner: false, isWritable: false },
      { pubkey: input.identityPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export async function tryReadArAgentIdentityPda(tokenMint: string): Promise<ArAgentIdentityPdaRead> {
  const mint = new PublicKey(tokenMint);
  const { pda } = findArAgentIdentityPda(mint);
  try {
    const info = await withAgentLaunchReadRpc((connection) =>
      connection.getAccountInfo(pda, "confirmed"),
    );
    return { pda: info ? pda.toBase58() : null, rpcBusy: false };
  } catch (error) {
    if (isSolanaRpcRateLimitedError(error)) {
      return { pda: null, rpcBusy: true };
    }
    throw error;
  }
}

export async function readArAgentIdentityPda(tokenMint: string): Promise<string | null> {
  const result = await tryReadArAgentIdentityPda(tokenMint);
  return result.pda;
}

export async function registerArAgentIdentity(
  input: ArAgentIdentityRegistrationInput,
): Promise<ArAgentIdentityRegistrationResult> {
  const mint = new PublicKey(input.tokenMint);
  const { pda } = findArAgentIdentityPda(mint);

  let existing: AccountInfo<Buffer> | null;
  try {
    existing = await withAgentLaunchReadRpc((connection) =>
      connection.getAccountInfo(pda, "confirmed"),
    );
  } catch (error) {
    if (isSolanaRpcRateLimitedError(error)) {
      throw new Error(SOLANA_RPC_BUSY_MESSAGE);
    }
    throw error;
  }

  if (existing) {
    return {
      identityPda: pda.toBase58(),
      tokenMint: mint.toBase58(),
      transactionSignature: "",
    };
  }

  const ix = buildRegisterInstruction({
    authority: input.signer.publicKey,
    tokenMint: mint,
    identityPda: pda,
    agentId: input.agentId,
    uri: input.uri,
    imageUri: input.imageUri,
    metadataUri: input.metadataUri,
  });
  const tx = new Transaction().add(ix);
  const connection = getAgentLaunchConnection();
  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [input.signer], {
      commitment: "confirmed",
    });
    return {
      identityPda: pda.toBase58(),
      tokenMint: mint.toBase58(),
      transactionSignature: signature,
    };
  } catch (error) {
    if (isSolanaRpcRateLimitedError(error)) {
      throw new Error(SOLANA_RPC_BUSY_MESSAGE);
    }
    throw error;
  }
}
