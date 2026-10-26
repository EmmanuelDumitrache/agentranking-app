import "server-only";

export type DetectedLeaderTrade = {
  type: "buy" | "sell";
  tokenMint: string;
  /** Absolute SOL spent (buy) or received (sell), in SOL units. */
  solAmount: number;
  /** Absolute token amount moved (human units). */
  tokenAmount: number;
  isFullSell: boolean;
};

type TokenBalanceLite = {
  owner?: string;
  mint: string;
  uiTokenAmount: { amount: string; decimals: number };
};

type ParsedTxLite = {
  meta: {
    err: unknown;
    preBalances: readonly number[];
    postBalances: readonly number[];
    preTokenBalances?: readonly TokenBalanceLite[] | null;
    postTokenBalances?: readonly TokenBalanceLite[] | null;
  } | null;
  transaction: {
    message: {
      accountKeys: ReadonlyArray<
        | string
        | { pubkey: string | { toString(): string }; toString?: () => string }
      >;
    };
  };
};

const MIN_SOL_DELTA = 0.00001;

function accountKeyToString(
  key: string | { pubkey: string | { toString(): string }; toString?: () => string },
): string {
  if (typeof key === "string") return key;
  if (typeof key.pubkey === "string") return key.pubkey;
  if (key.pubkey && typeof key.pubkey.toString === "function") {
    return key.pubkey.toString();
  }
  if (typeof key.toString === "function") return key.toString();
  return String(key);
}

function solDeltaForWallet(tx: ParsedTxLite, walletAddress: string): number | null {
  if (!tx.meta) return null;
  const keys = tx.transaction.message.accountKeys.map(accountKeyToString);
  const walletIndex = keys.indexOf(walletAddress);
  if (walletIndex === -1) return null;

  const pre = Number(tx.meta.preBalances[walletIndex] ?? 0);
  const post = Number(tx.meta.postBalances[walletIndex] ?? 0);
  const diffSol = (post - pre) / 1_000_000_000;
  if (Math.abs(diffSol) <= MIN_SOL_DELTA) return null;
  return diffSol;
}

function tokenHumanAmount(raw: bigint, decimals: number): number {
  if (decimals <= 0) return Number(raw);
  return Number(raw) / 10 ** decimals;
}

/**
 * Detect a leader spot buy/sell from a parsed Solana transaction.
 * Same heuristics as apebot: SOL↓ + token↑ = buy; SOL↑ + token↓ = sell.
 */
export function detectLeaderTradeFromTx(
  tx: ParsedTxLite,
  walletAddress: string,
): DetectedLeaderTrade | null {
  if (!tx.meta || tx.meta.err) return null;
  const preTokenBalances = tx.meta.preTokenBalances ?? [];
  const postTokenBalances = tx.meta.postTokenBalances ?? [];
  if (preTokenBalances.length === 0 && postTokenBalances.length === 0) return null;

  const solChange = solDeltaForWallet(tx, walletAddress);
  if (solChange == null) return null;

  const mints = new Set<string>();
  for (const row of preTokenBalances) mints.add(row.mint);
  for (const row of postTokenBalances) mints.add(row.mint);

  for (const mint of mints) {
    const post = postTokenBalances.find(
      (row) => row.owner === walletAddress && row.mint === mint,
    );
    const pre = preTokenBalances.find(
      (row) => row.owner === walletAddress && row.mint === mint,
    );
    const postAmount = BigInt(post?.uiTokenAmount.amount ?? "0");
    const preAmount = BigInt(pre?.uiTokenAmount.amount ?? "0");
    const tokenDiff = postAmount - preAmount;
    if (tokenDiff === 0n) continue;

    const absTokenDiff = tokenDiff < 0n ? -tokenDiff : tokenDiff;
    const decimals =
      post?.uiTokenAmount.decimals ?? pre?.uiTokenAmount.decimals ?? 0;

    if (solChange < 0 && tokenDiff > 0n) {
      return {
        type: "buy",
        tokenMint: mint,
        solAmount: Math.abs(solChange),
        tokenAmount: tokenHumanAmount(tokenDiff, decimals),
        isFullSell: false,
      };
    }
    if (solChange > 0 && tokenDiff < 0n) {
      return {
        type: "sell",
        tokenMint: mint,
        solAmount: solChange,
        tokenAmount: tokenHumanAmount(absTokenDiff, decimals),
        isFullSell: postAmount === 0n,
      };
    }
  }

  return null;
}
