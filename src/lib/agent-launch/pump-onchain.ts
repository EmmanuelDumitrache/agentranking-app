import "server-only";
import { bondingCurvePda } from "@pump-fun/pump-sdk";
import { Message, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import {
  extractMintFromPumpCreateLogs,
  isPumpCreateLogSet,
} from "@/lib/agent-launch/pump-create-logs";
import { withAgentLaunchReadRpc } from "@/lib/agent-launch/solana";
function resolveTransactionAccountKeys(tx: VersionedTransactionResponse): PublicKey[] {
  const message = tx.transaction.message;
  if ("version" in message) {
    return message
      .getAccountKeys({
        accountKeysFromLookups: tx.meta?.loadedAddresses,
      })
      .staticAccountKeys;
  }
  return (message as Message).accountKeys;
}
function isPumpCreateTransaction(tx: VersionedTransactionResponse): boolean {
  return isPumpCreateLogSet(tx.meta?.logMessages ?? []);
}
/** True when Pump.fun bonding curve account exists for this mint (token create landed). */
export async function pumpBondingCurveExists(mint: PublicKey): Promise<boolean> {
  try {
    const info = await withAgentLaunchReadRpc((connection) =>
      connection.getAccountInfo(bondingCurvePda(mint)),
    );
    return info != null && info.data.length > 0;
  } catch (error) {
    console.warn(
      "[agent-launch] bonding-curve lookup failed; treating mint as not on-chain",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
/** Best-effort: find a recent successful signature involving this mint (create tx). */
export async function findRecentMintCreationSignature(mint: PublicKey): Promise<string | null> {
  let signatures;
  try {
    signatures = await withAgentLaunchReadRpc((connection) =>
      connection.getSignaturesForAddress(mint, { limit: 25 }),
    );
  } catch {
    return null;
  }
  for (const entry of signatures) {
    if (entry.err) continue;
    if (entry.signature) return entry.signature;
  }
  return null;
}
export type DiscoveredPumpMint = {
  mint: PublicKey;
  signature: string;
};
/**
 * Scan a creator wallet's recent txs for a Pump create_v2 that landed on-chain.
 * Used when metadata confirm failed but the token exists.
 */
export async function discoverPumpMintCreatedByWallet(
  creator: PublicKey,
  notBeforeUnix?: number,
): Promise<DiscoveredPumpMint | null> {
  let signatures;
  try {
    signatures = await withAgentLaunchReadRpc((connection) =>
      connection.getSignaturesForAddress(creator, { limit: 40 }),
    );
  } catch (error) {
    console.warn(
      "[agent-launch] creator signature scan failed",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
  for (const entry of signatures) {
    if (entry.err || !entry.signature) continue;
    if (notBeforeUnix != null && entry.blockTime != null && entry.blockTime < notBeforeUnix) {
      continue;
    }
    let tx;
    try {
      tx = await withAgentLaunchReadRpc((connection) =>
        connection.getTransaction(entry.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }),
      );
    } catch {
      continue;
    }
    if (!tx?.meta || tx.meta.err) continue;
    if (!isPumpCreateTransaction(tx)) continue;
    const fromLogs = extractMintFromPumpCreateLogs(tx.meta.logMessages ?? []);
    if (fromLogs) {
      try {
        const mint = new PublicKey(fromLogs);
        if (await pumpBondingCurveExists(mint)) {
          return { mint, signature: entry.signature };
        }
      } catch {
        // fall through to account scan
      }
    }
    for (const key of resolveTransactionAccountKeys(tx)) {
      if (key.equals(creator)) continue;
      if (await pumpBondingCurveExists(key)) {
        return { mint: key, signature: entry.signature };
      }
    }
  }
  return null;
}