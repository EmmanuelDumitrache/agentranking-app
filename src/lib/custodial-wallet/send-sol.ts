import "server-only";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { getAgentLaunchConnection } from "@/lib/agent-launch/solana";
import { loadAgentCustodialKeypair } from "@/lib/custodial-wallet/sign-launch";
import { parseAgentLaunchNetwork, type AgentLaunchNetwork } from "@/lib/agent-launch/network";
import { formatLamportsAsSol } from "@/lib/custodial-wallet/sol-transfer-policy";
import { redactSensitiveText } from "@/lib/security/sensitive-data-redaction";
export type SendSolInput = {
  agentDbId: number;
  recipient: string;
  amountLamports: bigint;
};
export type SendSolResult =
  | { status: "sent"; signature: string; amountLamports: bigint; recipient: string; network: AgentLaunchNetwork }
  | { status: "invalid_address"; message: string }
  | { status: "invalid_amount"; message: string }
  | { status: "insufficient_balance"; message: string }
  | { status: "wallet_unavailable"; message: string }
  | { status: "error"; message: string };
export async function sendSolFromAgentWallet(input: SendSolInput): Promise<SendSolResult> {
  // Validate recipient
  let recipientPk: PublicKey;
  try {
    recipientPk = new PublicKey(input.recipient.trim());
  } catch {
    return { status: "invalid_address", message: "Invalid Solana address." };
  }
  // Amounts cross the persistence/broadcast boundary as integer lamports only.
  const amountLamports = input.amountLamports;
  if (amountLamports <= 0n) {
    return { status: "invalid_amount", message: "Amount must be greater than 0." };
  }
  // Load agent keypair
  const keypair = await loadAgentCustodialKeypair(input.agentDbId);
  if (!keypair) {
    return {
      status: "wallet_unavailable",
      message: "Agent wallet is not available. Provision the wallet first.",
    };
  }
  // Load wallet row for logging
  const walletRow = await prisma.custodialWallet.findFirst({
    where: { publicKey: keypair.publicKey.toBase58(), scope: "AGENT" },
    select: { id: true },
  });
  if (!walletRow) {
    return { status: "wallet_unavailable", message: "Agent wallet record not found in DB." };
  }
  const network = parseAgentLaunchNetwork(process.env.AGENT_LAUNCH_NETWORK);
  const connection = getAgentLaunchConnection();
  // Check balance
  let balance: bigint;
  try {
    balance = BigInt(await connection.getBalance(keypair.publicKey, "confirmed"));
  } catch (err) {
    const msg = redactSensitiveText(Error.isError(err) ? err.message : "RPC error");
    return { status: "error", message: `Could not fetch wallet balance: ${msg}` };
  }
  const estimatedTxFee = 10_000n; // simple SOL transfer fee allowance
  if (balance < amountLamports + estimatedTxFee) {
    return {
      status: "insufficient_balance",
      message: `Insufficient balance. Available: ${formatLamportsAsSol(balance)} SOL; the requested amount must also leave enough SOL for the network fee.`,
    };
  }
  // Create transfer log entry (pending)
  const transfer = await prisma.custodialWalletTransfer.create({
    data: {
      walletId: walletRow.id,
      agentDbId: input.agentDbId,
      network,
      token: "SOL",
      fromPublicKey: keypair.publicKey.toBase58(),
      toPublicKey: recipientPk.toBase58(),
      amountLamports,
      status: "pending",
    },
  });
  // Build and send the exact requested amount. Never silently reduce a transfer.
  try {
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: recipientPk,
        lamports: amountLamports,
      }),
    );
    tx.feePayer = keypair.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(keypair);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(signature, "confirmed");
    // Update transfer record
    await prisma.custodialWalletTransfer.update({
      where: { id: transfer.id },
      data: {
        signature,
        status: "confirmed",
        confirmedAt: new Date(),
      },
    });
    return { status: "sent", signature, amountLamports, recipient: recipientPk.toBase58(), network };
  } catch (err) {
    const raw = redactSensitiveText(Error.isError(err) ? err.message : String(err));
    let message: string;
    if (raw.toLowerCase().includes("insufficient") || raw.toLowerCase().includes("0x1")) {
      message = "Insufficient balance — the wallet doesn't have enough SOL to cover the transfer plus transaction fees.";
    } else if (raw.toLowerCase().includes("timeout") || raw.toLowerCase().includes("timed out")) {
      message = "Transaction timed out. The network may be congested. Try again or use a smaller amount.";
    } else if (raw.toLowerCase().includes("blockhash") || raw.toLowerCase().includes("not found")) {
      message = "Transaction expired. The network may be slow. Try again.";
    } else {
      message = raw.length > 300 ? `Transfer failed. ${raw.slice(0, 300)}…` : `Transfer failed. ${raw}`;
    }
    await prisma.custodialWalletTransfer.update({
      where: { id: transfer.id },
      data: {
        status: "failed",
        errorMessage: raw.slice(0, 2000),
      },
    });
    return { status: "error", message };
  }
}
/** Verification payment helper. */
export type SendForVerificationInput = {
  agentDbId: number;
  recipient: string;
  amountSol: number;
};
export type SendForVerificationResult =
  | { status: "sent"; signature: string; amountLamports: bigint; recipient: string; fromPublicKey: string }
  | { status: "invalid_address"; message: string }
  | { status: "invalid_amount"; message: string }
  | { status: "insufficient_balance"; message: string }
  | { status: "wallet_unavailable"; message: string }
  | { status: "error"; message: string };
export async function sendSolForVerification(input: SendForVerificationInput): Promise<SendForVerificationResult> {
  let recipientPk: PublicKey;
  try {
    recipientPk = new PublicKey(input.recipient.trim());
  } catch {
    return { status: "invalid_address", message: "Invalid Solana address." };
  }
  if (!Number.isFinite(input.amountSol) || input.amountSol <= 0) {
    return { status: "invalid_amount", message: "Amount must be greater than 0." };
  }
  const amountLamports = BigInt(Math.round(input.amountSol * LAMPORTS_PER_SOL));
  if (amountLamports <= BigInt(0)) {
    return { status: "invalid_amount", message: "Amount must be greater than 0." };
  }
  const keypair = await loadAgentCustodialKeypair(input.agentDbId);
  if (!keypair) {
    return { status: "wallet_unavailable", message: "Agent wallet is not available. Provision the wallet first." };
  }
  const walletRow = await prisma.custodialWallet.findFirst({
    where: { publicKey: keypair.publicKey.toBase58(), scope: "AGENT" },
    select: { id: true },
  });
  if (!walletRow) {
    return { status: "wallet_unavailable", message: "Agent wallet record not found in DB." };
  }
  const connection = getAgentLaunchConnection();
  let balance: bigint;
  try {
    balance = BigInt(await connection.getBalance(keypair.publicKey, "confirmed"));
  } catch (err) {
    const msg = redactSensitiveText(Error.isError(err) ? err.message : "RPC error");
    return { status: "error", message: `Could not fetch wallet balance: ${msg}` };
  }
  const ESTIMATED_TX_FEE = BigInt(10_000);
  const totalNeeded = amountLamports + ESTIMATED_TX_FEE;
  if (balance < totalNeeded) {
    return {
      status: "insufficient_balance",
      message: `This agent wallet needs at least ${(Number(totalNeeded) / LAMPORTS_PER_SOL).toFixed(6)} SOL (${(Number(amountLamports) / LAMPORTS_PER_SOL).toFixed(4)} fee + network). Has ${(Number(balance) / LAMPORTS_PER_SOL).toFixed(6)} SOL.`,
    };
  }
  const network = parseAgentLaunchNetwork(process.env.AGENT_LAUNCH_NETWORK);
  const transfer = await prisma.custodialWalletTransfer.create({
    data: {
      walletId: walletRow.id,
      agentDbId: input.agentDbId,
      network,
      token: "SOL",
      fromPublicKey: keypair.publicKey.toBase58(),
      toPublicKey: recipientPk.toBase58(),
      amountLamports,
      status: "pending",
    },
  });
  try {
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: recipientPk,
        lamports: amountLamports,
      }),
    );
    tx.feePayer = keypair.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(keypair);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(signature, "confirmed");
    await prisma.custodialWalletTransfer.update({
      where: { id: transfer.id },
      data: { signature, status: "confirmed", confirmedAt: new Date() },
    });
    return {
      status: "sent",
      signature,
      amountLamports,
      recipient: recipientPk.toBase58(),
      fromPublicKey: keypair.publicKey.toBase58(),
    };
  } catch (err) {
    const raw = redactSensitiveText(Error.isError(err) ? err.message : String(err));
    const message =
      raw.toLowerCase().includes("insufficient") || raw.toLowerCase().includes("0x1")
        ? "Insufficient agent wallet balance — the wallet doesn't have enough SOL to cover the verification plus transaction fees."
        : raw.length > 300
          ? `Verification transfer failed. ${raw.slice(0, 300)}…`
          : `Verification transfer failed. ${raw}`;
    await prisma.custodialWalletTransfer.update({
      where: { id: transfer.id },
      data: { status: "failed", errorMessage: raw.slice(0, 2000) },
    });
    return { status: "error", message };
  }
}
