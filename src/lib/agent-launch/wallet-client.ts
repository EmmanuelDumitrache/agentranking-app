"use client";
import {
  Keypair,
  Transaction,
  Connection,
  PublicKey,
  SystemProgram,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getSolanaWalletProvider } from "@/lib/ar-token-ledger";
import {
  connectInjectedWallet,
  subscribeInjectedWalletAccount,
} from "@/lib/solana-injected-wallet";
import { MAX_DEVNET_AIRDROP_LAMPORTS } from "@/lib/agent-launch/constants-local";
import {
  parseAgentLaunchNetwork,
  type AgentLaunchNetwork,
} from "@/lib/agent-launch/network";
import { isBrowserUnsafeSolanaRpcUrl } from "@/lib/agent-launch/solana-rpc-safety";
export type WalletNetworkHint = "devnet" | "mainnet-beta" | "testnet" | "unknown";
export { subscribeInjectedWalletAccount };
export function generateMintKeypair(): Keypair {
  return Keypair.generate();
}
/** Client launch network — must match Phantom's cluster (mainnet vs devnet). */
export function resolveAgentLaunchClientNetwork(
  network?: AgentLaunchNetwork,
): AgentLaunchNetwork {
  if (network) return network;
  // Prefer launch-specific public flag; fall back to site Solana network so a
  // missing NEXT_PUBLIC_AGENT_LAUNCH_NETWORK does not silently query devnet.
  const fromEnv =
    process.env.NEXT_PUBLIC_AGENT_LAUNCH_NETWORK?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_NETWORK?.trim() ||
    process.env.NEXT_PUBLIC_AR_SOLANA_CLUSTER?.trim() ||
    "devnet";
  return parseAgentLaunchNetwork(fromEnv);
}
/** Sticky preferred RPC after a successful fallback (avoids hammering a dead Helius key). */
const preferredClientRpcByNetwork = new Map<AgentLaunchNetwork, string>();
function pushSafeClientRpc(candidates: string[], url: string | undefined): void {
  const trimmed = url?.trim();
  if (!trimmed || isBrowserUnsafeSolanaRpcUrl(trimmed)) return;
  candidates.push(trimmed);
}
/**
 * Ordered client RPC candidates for send/confirm only.
 * Balance + blockhash go through same-origin `/api/public-launch/solana/*` (server RPC).
 * Do not prefer NEXT_PUBLIC Helius — that key is exposed and rate-limited in production.
 */
export function resolveAgentLaunchClientRpcCandidates(
  network?: AgentLaunchNetwork,
): string[] {
  const resolved = resolveAgentLaunchClientNetwork(network);
  const candidates: string[] = [];
  const preferred = preferredClientRpcByNetwork.get(resolved);
  pushSafeClientRpc(candidates, preferred);
  if (resolved === "mainnet-beta") {
    // Browser-safe public RPCs only. Never use api.mainnet-beta.solana.com from
    // the browser — it returns JSON-RPC 403 "Access forbidden" for Origin requests.
    candidates.push("https://solana-rpc.publicnode.com");
    candidates.push(
      "https://g.w.lavanet.xyz/gateway/solana/rpc-http/d0bb489e58484729b8636c38efc610f3",
    );
  } else {
    pushSafeClientRpc(candidates, process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL);
    candidates.push(clusterApiUrl("devnet"));
  }
  return [...new Set(candidates.filter(Boolean))];
}
export function resolveAgentLaunchClientRpcUrl(network?: AgentLaunchNetwork): string {
  return resolveAgentLaunchClientRpcCandidates(network)[0] ?? clusterApiUrl("mainnet-beta");
}
function isSolanaRpcRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /\b429\b/.test(message) ||
    /\b403\b/.test(message) ||
    /access forbidden/i.test(message) ||
    /too many requests/i.test(message) ||
    /max usage reached/i.test(message) ||
    /rate.?limit/i.test(message) ||
    /failed to get balance of account/i.test(message) ||
    /-32429/.test(message)
  );
}
/** Stale blockhash after a slow Phantom approval — rebuild tx and re-sign once. */
function isBlockhashExpiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /block height exceeded/i.test(message) ||
    /blockhash not found/i.test(message) ||
    /transaction expired/i.test(message) ||
    /signature.*expired/i.test(message)
  );
}
async function confirmFundingSignature(
  connection: Connection,
  signature: string,
  recentBlockhash: string,
  lastValidBlockHeight: number,
): Promise<void> {
  try {
    await connection.confirmTransaction(
      { signature, blockhash: recentBlockhash, lastValidBlockHeight },
      "confirmed",
    );
    return;
  } catch (error) {
    if (!isBlockhashExpiredError(error)) throw error;
    // Phantom can take >60s — tx may still have landed before blockhash expired.
    for (let i = 0; i < 12; i++) {
      const status = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });
      const value = status.value;
      if (value?.err) {
        throw new Error(`Funding transfer failed on-chain: ${JSON.stringify(value.err)}`);
      }
      if (
        value?.confirmationStatus === "confirmed" ||
        value?.confirmationStatus === "finalized"
      ) {
        return;
      }
      await new Promise((r) => setTimeout(r, 1_500));
    }
    throw error;
  }
}
function createAgentLaunchClientConnection(rpcUrl: string): Connection {
  // Fail fast on 429 so we can rotate endpoints instead of web3.js backing off 500ms→4s.
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
  });
}
async function withAgentLaunchClientRpcFallback<T>(
  network: AgentLaunchNetwork | undefined,
  operation: (connection: Connection, rpcUrl: string) => Promise<T>,
): Promise<T> {
  const resolved = resolveAgentLaunchClientNetwork(network);
  const candidates = resolveAgentLaunchClientRpcCandidates(resolved);
  let lastError: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const rpcUrl = candidates[i]!;
    const connection = createAgentLaunchClientConnection(rpcUrl);
    try {
      const result = await operation(connection, rpcUrl);
      preferredClientRpcByNetwork.set(resolved, rpcUrl);
      return result;
    } catch (error) {
      lastError = error;
      const canFallback =
        i < candidates.length - 1 && isSolanaRpcRetryableError(error);
      if (!canFallback) throw error;
      if (preferredClientRpcByNetwork.get(resolved) === rpcUrl) {
        preferredClientRpcByNetwork.delete(resolved);
      }
      console.warn(
        `[agent-launch] client RPC blocked/rate-limited (${rpcUrl}); trying fallback`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All Solana RPC endpoints failed");
}
export function isPhantomAvailable(): boolean {
  return Boolean(getSolanaWalletProvider());
}
export async function connectAgentLaunchWallet() {
  return connectInjectedWallet({ onlyIfTrustedFirst: false });
}
export async function disconnectAgentLaunchWallet(): Promise<void> {
  const provider = getSolanaWalletProvider();
  if (!provider) return;
  try {
    await provider.disconnect();
  } catch {
    // Provider may already be disconnected.
  }
}
export function getConnectedWalletAddress(): string | null {
  return getSolanaWalletProvider()?.publicKey?.toBase58() ?? null;
}
export async function detectWalletNetworkHint(): Promise<WalletNetworkHint> {
  const provider = getSolanaWalletProvider() as ReturnType<typeof getSolanaWalletProvider> & {
    request?: (args: { method: string }) => Promise<{ network?: string }>;
  };
  if (!provider?.request) return "unknown";
  try {
    const response = await provider.request({ method: "solana_getNetwork" });
    const network = response?.network?.toLowerCase();
    if (network === "devnet") return "devnet";
    if (network === "mainnet-beta" || network === "mainnet") return "mainnet-beta";
    if (network === "testnet") return "testnet";
  } catch {
    // Not supported by this wallet build.
  }
  return "unknown";
}
export async function requestDevnetAirdrop(wallet: string, lamports = MAX_DEVNET_AIRDROP_LAMPORTS) {
  const res = await fetch("/api/agent-launch/devnet-airdrop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, lamports }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Devnet airdrop failed");
  }
  return data as {
    signature: string;
    wallet: string;
    lamports: number;
    balanceLamports: string;
    explorerUrl: string;
  };
}
/** SOL balance via same-origin API (server private RPC) — never browser→Helius. */
export async function fetchDevnetSolBalance(publicKey: string): Promise<bigint> {
  const address = publicKey.trim();
  if (!address) throw new Error("Wallet address is required");
  const res = await fetch(
    `/api/public-launch/solana/balance?address=${encodeURIComponent(address)}`,
    { method: "GET", cache: "no-store" },
  );
  const raw = await res.text();
  let data: { lamports?: number; lamportsStr?: string; error?: string };
  try {
    data = (raw ? JSON.parse(raw) : {}) as {
      lamports?: number;
      lamportsStr?: string;
      error?: string;
    };
  } catch {
    throw new Error(
      raw.trim()
        ? `Failed to read SOL balance: ${raw.replace(/\s+/g, " ").trim().slice(0, 160)}`
        : "Failed to read SOL balance",
    );
  }
  if (!res.ok) {
    throw new Error(data.error || "Failed to read SOL balance");
  }
  if (typeof data.lamportsStr === "string" && data.lamportsStr.length > 0) {
    return BigInt(data.lamportsStr);
  }
  if (typeof data.lamports === "number" && Number.isFinite(data.lamports)) {
    return BigInt(data.lamports);
  }
  throw new Error("Invalid balance response");
}
async function fetchServerLatestBlockhash(network: AgentLaunchNetwork): Promise<{
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  const res = await fetch(
    `/api/public-launch/solana/latest-blockhash?network=${encodeURIComponent(network)}`,
    { method: "GET", cache: "no-store" },
  );
  const raw = await res.text();
  let data: { blockhash?: string; lastValidBlockHeight?: number; error?: string };
  try {
    data = (raw ? JSON.parse(raw) : {}) as {
      blockhash?: string;
      lastValidBlockHeight?: number;
      error?: string;
    };
  } catch {
    throw new Error(
      raw.trim()
        ? `Failed to fetch latest blockhash: ${raw.replace(/\s+/g, " ").trim().slice(0, 160)}`
        : "Failed to fetch latest blockhash",
    );
  }
  if (!res.ok || !data.blockhash || typeof data.lastValidBlockHeight !== "number") {
    throw new Error(data.error || "Failed to fetch latest blockhash");
  }
  return {
    blockhash: data.blockhash,
    lastValidBlockHeight: data.lastValidBlockHeight,
  };
}
/** Keep a tiny reserve so Phantom can pay the transfer fee (~5–15k lamports). */
const PHANTOM_TX_FEE_RESERVE_LAMPORTS = 15_000;
/**
 * Public Metaplex Genesis launches still execute from a server-held agent wallet.
 * From /launch/new, fund that wallet with one Phantom-approved transfer (connected wallet UX).
 */
export async function fundAddressFromConnectedWallet(input: {
  toAddress: string;
  lamports: number;
}): Promise<{ signature: string; lamportsSent: number }> {
  if (!Number.isFinite(input.lamports) || input.lamports <= 0) {
    throw new Error("Funding amount must be a positive SOL amount.");
  }
  const provider = getSolanaWalletProvider();
  if (!provider?.publicKey) {
    await connectInjectedWallet({ onlyIfTrustedFirst: false });
  }
  const active = getSolanaWalletProvider();
  if (!active?.publicKey) {
    throw new Error("Connect Phantom to continue.");
  }
  const network = resolveAgentLaunchClientNetwork();
  const toPubkey = new PublicKey(input.toAddress.trim());
  const fromPubkey = active.publicKey;
  const networkLabel = network === "mainnet-beta" ? "mainnet" : network;
  // Balance + blockhash via same-origin server RPC (never browser→burned Helius).
  // If the server read fails, skip preflight and send input.lamports — Phantom/chain reject if underfunded.
  const lamportsToSend = input.lamports;
  try {
    const balanceLamports = Number(
      await fetchDevnetSolBalance(fromPubkey.toBase58()),
    );
    const maxSendable = Math.max(0, balanceLamports - PHANTOM_TX_FEE_RESERVE_LAMPORTS);
    if (maxSendable <= 0) {
      throw new Error(
        `No SOL found on Solana ${networkLabel} for the connected Phantom. Switch Phantom to ${networkLabel} (or fund this address on ${networkLabel}), then approve the transfer.`,
      );
    }
    if (maxSendable < input.lamports) {
      throw new Error(
        `Phantom needs about ${(input.lamports / LAMPORTS_PER_SOL).toFixed(3)} SOL on ${networkLabel} for this launch (plus a tiny network fee). Connected balance: ${(balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL.`,
      );
    }
  } catch (error) {
    if (!isSolanaRpcRetryableError(error)) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      // Surface underfunded / user errors; soft-fail only on RPC outages.
      if (
        /no sol found/i.test(message) ||
        /phantom needs about/i.test(message) ||
        /invalid solana address/i.test(message)
      ) {
        throw error;
      }
      if (!/failed to read sol balance|502|503|504/i.test(message)) {
        throw error;
      }
    }
  }
  const buildTransferTx = (recentBlockhash: string) => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports: lamportsToSend,
      }),
    );
    tx.feePayer = fromPubkey;
    tx.recentBlockhash = recentBlockhash;
    return tx;
  };
  const sendSignedTransfer = async (
    signed: Transaction,
    recentBlockhash: string,
    validBlockHeight: number,
  ): Promise<{ signature: string; lamportsSent: number }> =>
    withAgentLaunchClientRpcFallback(network, async (connection) => {
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await confirmFundingSignature(
        connection,
        signature,
        recentBlockhash,
        validBlockHeight,
      );
      return { signature, lamportsSent: lamportsToSend };
    });
  // Fetch blockhash immediately before Phantom signs — slow approvals expire ~60s blockhashes.
  const MAX_FUNDING_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_FUNDING_ATTEMPTS; attempt++) {
    const { blockhash: freshBlockhash, lastValidBlockHeight: freshHeight } =
      await fetchServerLatestBlockhash(network);
    const tx = buildTransferTx(freshBlockhash);
    try {
      if (active.signTransaction) {
        const signed = await active.signTransaction(tx);
        return await sendSignedTransfer(signed, freshBlockhash, freshHeight);
      }
      if (active.signAndSendTransaction) {
        const result = await active.signAndSendTransaction(tx);
        const signature = typeof result === "string" ? result : result.signature;
        await withAgentLaunchClientRpcFallback(network, async (connection) => {
          await confirmFundingSignature(
            connection,
            signature,
            freshBlockhash,
            freshHeight,
          );
        });
        return { signature, lamportsSent: lamportsToSend };
      }
      throw new Error("Wallet does not support transaction signing.");
    } catch (error) {
      lastError = error;
      if (attempt < MAX_FUNDING_ATTEMPTS - 1 && isBlockhashExpiredError(error)) {
        console.warn("[agent-launch] funding tx blockhash expired; retrying with fresh blockhash");
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Funding transfer failed after blockhash retry");
}
export async function signAndSendAgentLaunchTransaction(input: {
  transactionBase64: string;
  mintSecretKey?: Uint8Array;
  /** When set, sign with the agent's server-held custodial wallet (no Phantom). */
  agentDbId?: number;
  creatorWallet?: string;
}): Promise<string> {
  if (input.agentDbId != null && input.agentDbId > 0) {
    const res = await fetch(`/api/dashboard/agents/${input.agentDbId}/sign-launch-tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionBase64: input.transactionBase64,
        mintSecretKeyBase58: input.mintSecretKey
          ? bs58.encode(input.mintSecretKey)
          : undefined,
        expectedSigner: input.creatorWallet,
      }),
    });
    const data = (await res.json()) as { signature?: string; error?: string };
    if (!res.ok || !data.signature) {
      throw new Error(data.error || "Agent wallet could not sign this transaction.");
    }
    return data.signature;
  }
  const provider = getSolanaWalletProvider();
  if (!provider?.publicKey) {
    await connectInjectedWallet({ onlyIfTrustedFirst: false });
  }
  const active = getSolanaWalletProvider();
  if (!active?.publicKey) {
    throw new Error("Connect a Solana wallet (Phantom) to continue.");
  }
  const tx = Transaction.from(Buffer.from(input.transactionBase64, "base64"));
  if (input.mintSecretKey) {
    const mintKeypair = Keypair.fromSecretKey(input.mintSecretKey);
    tx.partialSign(mintKeypair);
  }
  let signedTx: Transaction;
  if (active.signTransaction) {
    signedTx = await active.signTransaction(tx);
  } else if (active.signAndSendTransaction) {
    const result = await active.signAndSendTransaction(tx);
    if (typeof result === "string") return result;
    return result.signature;
  } else {
    throw new Error("Wallet does not support transaction signing.");
  }
  const network = resolveAgentLaunchClientNetwork();
  return withAgentLaunchClientRpcFallback(network, async (connection) => {
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await connection.confirmTransaction(signature, "confirmed");
    return signature;
  });
}
export function exportMintSecretKeyBase58(keypair: Keypair): string {
  return bs58.encode(keypair.secretKey);
}
export function importMintSecretKeyBase58(encoded: string): Uint8Array {
  return bs58.decode(encoded);
}
