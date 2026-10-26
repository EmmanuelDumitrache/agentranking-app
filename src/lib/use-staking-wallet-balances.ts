"use client";
import { useCallback, useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { formatUnits } from "viem";
import { useAsyncResource } from "@/hooks/use-async-resource";
import {
  formatSplBalanceUi,
  readSplBalanceSnapshot,
} from "@/lib/use-solana-ar-balance";
function formatBalanceLabel(
  publicKey: PublicKey | null,
  enabled: boolean,
  fetching: boolean,
  hasLoadedOnce: boolean,
  queryError: boolean,
  format: () => string,
): string {
  if (!publicKey || !enabled) return "—";
  if (queryError && !hasLoadedOnce) return "Unavailable";
  if (fetching && !hasLoadedOnce) return "…";
  try {
    return format();
  } catch {
    return hasLoadedOnce ? "—" : "Unavailable";
  }
}
export function useStakingWalletBalances(opts: {
  /** Must be the canonical $AR SPL mint (92eXv…), not the Streamflow stake pool mint. */
  mintPk: PublicKey | null;
  arDecimals: number;
  enabled: boolean;
  /** Injected Phantom key when wallet-adapter has not synced yet. */
  ownerPublicKey?: PublicKey | null;
}) {
  const { mintPk, arDecimals, enabled, ownerPublicKey = null } = opts;
  const { connection: adapterConnection } = useConnection();
  const { publicKey, disconnect } = useWallet();
  const owner = ownerPublicKey ?? publicKey ?? null;
  const ownerAddress = owner?.toBase58() ?? null;
  const mintAddress = mintPk?.toBase58() ?? null;
  const connection = useMemo(() => {
    const endpoint = adapterConnection.rpcEndpoint;
    return new Connection(endpoint, adapterConnection.commitment ?? "confirmed");
  }, [adapterConnection.rpcEndpoint, adapterConnection.commitment]);
  type BalanceSnapshot = {
    readonly solLamports: bigint;
    readonly arBalanceRaw: bigint;
    readonly arDecimalsResolved: number;
  };
  const loadBalances = useCallback(async (signal: AbortSignal): Promise<BalanceSnapshot> => {
    if (!enabled || !ownerAddress) {
      return {
        solLamports: BigInt(0),
        arBalanceRaw: BigInt(0),
        arDecimalsResolved: arDecimals,
      };
    }
    const ownerPk = new PublicKey(ownerAddress);
    const mintPkResolved = mintAddress ? new PublicKey(mintAddress) : null;
    const solPromise = connection.getBalance(ownerPk, "confirmed");
    const arPromise = mintPkResolved
      ? readSplBalanceSnapshot(connection, mintPkResolved, ownerPk)
      : Promise.resolve({ raw: BigInt(0), decimals: arDecimals });
    const [lamports, arSnap] = await Promise.all([solPromise, arPromise]);
    if (signal.aborted) throw signal.reason;
    const resolvedDecimals =
      Number.isFinite(arSnap.decimals) && arSnap.decimals >= 0 && arSnap.decimals <= 12
        ? arSnap.decimals
        : arDecimals;
    return {
      solLamports: BigInt(lamports),
      arBalanceRaw: arSnap.raw,
      arDecimalsResolved: resolvedDecimals,
    };
  }, [enabled, ownerAddress, mintAddress, connection, arDecimals]);
  const balanceResource = useAsyncResource(
    `staking-wallet-balances:${enabled ? ownerAddress ?? "no-owner" : "disabled"}:${mintAddress ?? "no-mint"}:${connection.rpcEndpoint}:${arDecimals}`,
    loadBalances,
  );
  const emptySnapshot: BalanceSnapshot = {
    solLamports: BigInt(0),
    arBalanceRaw: BigInt(0),
    arDecimalsResolved: arDecimals,
  };
  const snapshot = balanceResource.data ?? emptySnapshot;
  const { solLamports, arBalanceRaw, arDecimalsResolved } = snapshot;
  const fetching = enabled && Boolean(ownerAddress) && balanceResource.loading;
  const queryError = Boolean(balanceResource.error);
  const hasLoadedOnce = enabled && Boolean(ownerAddress) && balanceResource.data !== null;
  const refetch = balanceResource.refresh;
  const balancesRefreshing = fetching && hasLoadedOnce;
  const solLabel = useMemo(
    () =>
      formatBalanceLabel(owner, enabled, fetching, hasLoadedOnce, queryError, () =>
        formatUnits(solLamports, 9),
      ),
    [owner, enabled, fetching, hasLoadedOnce, queryError, solLamports],
  );
  const arLabel = useMemo(
    () =>
      formatBalanceLabel(owner, enabled && Boolean(mintPk), fetching, hasLoadedOnce, queryError, () =>
        formatSplBalanceUi(arBalanceRaw, arDecimalsResolved),
      ),
    [owner, enabled, mintPk, fetching, hasLoadedOnce, queryError, arBalanceRaw, arDecimalsResolved],
  );
  return {
    publicKey: owner,
    disconnect,
    solLamports,
    arBalanceRaw,
    arDecimalsResolved,
    solLabel,
    arLabel,
    fetching,
    balancesRefreshing,
    hasLoadedOnce,
    queryError,
    refetch,
    mintAddress,
  };
}
