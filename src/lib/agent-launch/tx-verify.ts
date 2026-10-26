import "server-only";
import {
  Message,
  PublicKey,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { getAgentLaunchConnection, getAgentLaunchNetwork } from "@/lib/agent-launch/solana";
import { fetchTransactionWithRetry } from "@/lib/agent-launch/tx-poll";
function txNotFoundReason(): string {
  const network = getAgentLaunchNetwork();
  return network === "devnet"
    ? "Transaction not found on devnet"
    : "Transaction not found on mainnet";
}
export type CreationTxVerification = {
  ok: boolean;
  reason?: string;
  transferredLamports: bigint;
  treasury: string;
  signerMatches: boolean;
};
function resolveTransactionAccountKeys(
  tx: VersionedTransactionResponse,
): PublicKey[] {
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
export async function verifyCreationTransaction(input: {
  signature: string;
  expectedCreator: PublicKey;
  expectedTreasury: PublicKey;
  minimumFeeLamports: bigint;
  expectedMint?: PublicKey;
}): Promise<CreationTxVerification> {
  const connection = getAgentLaunchConnection();
  const tx = await fetchTransactionWithRetry(connection, input.signature);
  if (!tx) {
    return {
      ok: false,
      reason: txNotFoundReason(),
      transferredLamports: BigInt(0),
      treasury: input.expectedTreasury.toBase58(),
      signerMatches: false,
    };
  }
  if (tx.meta?.err) {
    return {
      ok: false,
      reason: `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}`,
      transferredLamports: BigInt(0),
      treasury: input.expectedTreasury.toBase58(),
      signerMatches: false,
    };
  }
  const accountKeys = resolveTransactionAccountKeys(tx);
  const treasuryIndex = accountKeys.findIndex((k) =>
    k.equals(input.expectedTreasury),
  );
  const creatorIndex = accountKeys.findIndex((k) =>
    k.equals(input.expectedCreator),
  );
  const signerMatches = creatorIndex >= 0;
  if (creatorIndex < 0) {
    return {
      ok: false,
      reason: "Expected creator not present in transaction accounts",
      transferredLamports: BigInt(0),
      treasury: input.expectedTreasury.toBase58(),
      signerMatches,
    };
  }
  const preBalances = tx.meta?.preBalances ?? [];
  const postBalances = tx.meta?.postBalances ?? [];
  const treasuryDelta =
    treasuryIndex >= 0
      ? BigInt(postBalances[treasuryIndex] ?? 0) - BigInt(preBalances[treasuryIndex] ?? 0)
      : BigInt(0);
  const creatorDelta =
    BigInt(postBalances[creatorIndex] ?? 0) - BigInt(preBalances[creatorIndex] ?? 0);
  if (input.minimumFeeLamports > BigInt(0)) {
    if (treasuryIndex < 0) {
      return {
        ok: false,
        reason: "Expected treasury not present in platform fee transfer transaction",
        transferredLamports: BigInt(0),
        treasury: input.expectedTreasury.toBase58(),
        signerMatches,
      };
    }
    if (treasuryDelta < input.minimumFeeLamports) {
      return {
        ok: false,
        reason: `Treasury received ${treasuryDelta} lamports; expected at least ${input.minimumFeeLamports}`,
        transferredLamports: treasuryDelta,
        treasury: input.expectedTreasury.toBase58(),
        signerMatches,
      };
    }
    if (creatorDelta >= BigInt(0)) {
      return {
        ok: false,
        reason: "Creator balance did not decrease — platform fee transfer missing",
        transferredLamports: treasuryDelta,
        treasury: input.expectedTreasury.toBase58(),
        signerMatches,
      };
    }
  }
  if (input.expectedMint) {
    const mintPresent = accountKeys.some((k) => k.equals(input.expectedMint!));
    if (!mintPresent) {
      return {
        ok: false,
        reason: "Expected mint not found in transaction accounts",
        transferredLamports: treasuryDelta,
        treasury: input.expectedTreasury.toBase58(),
        signerMatches,
      };
    }
  }
  return {
    ok: true,
    transferredLamports: treasuryDelta,
    treasury: input.expectedTreasury.toBase58(),
    signerMatches,
  };
}
export type FeeShareTxVerification = {
  ok: boolean;
  reason?: string;
  sharingConfig?: string;
  sharesMatch: boolean;
};
export async function verifyFeeShareTransaction(input: {
  signature: string;
  mint: PublicKey;
  expectedCreator: PublicKey;
  expectedTreasury: PublicKey;
  creatorShareBps: number;
  arShareBps: number;
  sharingConfig?: string;
}): Promise<FeeShareTxVerification> {
  const connection = getAgentLaunchConnection();
  const tx = await fetchTransactionWithRetry(connection, input.signature);
  if (!tx) {
    return { ok: false, reason: txNotFoundReason(), sharesMatch: false };
  }
  if (tx.meta?.err) {
    return {
      ok: false,
      reason: `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}`,
      sharesMatch: false,
    };
  }
  const { fetchOnChainFeeShareConfig } = await import("@/lib/agent-launch/pump-fee-sharing");
  const onChain = await fetchOnChainFeeShareConfig(input.mint);
  if (!onChain) {
    return {
      ok: false,
      reason: "Sharing config account not found after transaction",
      sharingConfig: input.sharingConfig,
      sharesMatch: false,
    };
  }
  const shareholders = onChain.config.shareholders;
  const sharesMatch = matchesExpectedShares(shareholders, [
    { address: input.expectedCreator, shareBps: input.creatorShareBps },
    { address: input.expectedTreasury, shareBps: input.arShareBps },
  ]);
  if (!sharesMatch) {
    return {
      ok: false,
      reason: `On-chain fee share config does not match expected ${input.creatorShareBps / 100}/${input.arShareBps / 100} routing`,
      sharingConfig: onChain.address,
      sharesMatch: false,
    };
  }
  return {
    ok: true,
    sharingConfig: onChain.address,
    sharesMatch: true,
  };
}
export async function verifyInvestorTestTransaction(
  signature: string,
  expectedMint?: PublicKey,
): Promise<{ ok: boolean; reason?: string }> {
  const connection = getAgentLaunchConnection();
  const tx = await fetchTransactionWithRetry(connection, signature);
  if (!tx) {
    return { ok: false, reason: txNotFoundReason() };
  }
  if (tx.meta?.err) {
    return {
      ok: false,
      reason: `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}`,
    };
  }
  if (expectedMint) {
    const accountKeys = resolveTransactionAccountKeys(tx);
    const mintPresent = accountKeys.some((k) => k.equals(expectedMint));
    if (!mintPresent) {
      return { ok: false, reason: "Expected mint not found in transaction accounts" };
    }
  }
  return { ok: true };
}
function matchesExpectedShares(
  actual: { address: PublicKey; shareBps: number }[],
  expected: { address: PublicKey; shareBps: number }[],
): boolean {
  if (actual.length !== expected.length) return false;
  for (const exp of expected) {
    const found = actual.find(
      (a) => a.address.equals(exp.address) && a.shareBps === exp.shareBps,
    );
    if (!found) return false;
  }
  return true;
}