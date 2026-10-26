import type { PreparedRobinhoodLaunchTx, RobinhoodLaunchFormFields } from "@/lib/robinhood-chain/types";
import { ROBINHOOD_CHAIN_ID } from "@/lib/robinhood-chain/config";
import { mapWalletError } from "@/lib/robinhood-chain/errors";
export type RobinhoodLaunchProgressPhase =
  | "idle"
  | "preparing"
  | "signing"
  | "indexing"
  | "done"
  | "error";
export type RobinhoodLaunchResult = {
  tokenAddress: string;
  txHash: string;
};
export type RobinhoodLaunchFeeData = {
  launchFeeEth: string | null;
  launchFeeWei: string | null;
  estimatedGasUnits: string | null;
  estimatedGasCostEth: string | null;
  estimatedGasCostWei: string | null;
};
export async function fetchRobinhoodLaunchFee(): Promise<RobinhoodLaunchFeeData> {
  try {
    const res = await fetch("/api/robinhood/prepare-launch");
    const data = (await res.json()) as {
      launchFeeEth?: string;
      launchFeeWei?: string;
      estimatedGasUnits?: string;
      estimatedGasCostEth?: string;
      estimatedGasCostWei?: string;
    };
    return {
      launchFeeEth: data.launchFeeEth ?? null,
      launchFeeWei: data.launchFeeWei ?? null,
      estimatedGasUnits: data.estimatedGasUnits ?? null,
      estimatedGasCostEth: data.estimatedGasCostEth ?? null,
      estimatedGasCostWei: data.estimatedGasCostWei ?? null,
    };
  } catch {
    return {
      launchFeeEth: null,
      launchFeeWei: null,
      estimatedGasUnits: null,
      estimatedGasCostEth: null,
      estimatedGasCostWei: null,
    };
  }
}
export async function runRobinhoodLaunchPipeline(input: {
  form: RobinhoodLaunchFormFields;
  sendTransaction: (tx: {
    chainId: number;
    account: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
    gas?: bigint;
  }) => Promise<`0x${string}`>;
  onPhase?: (phase: RobinhoodLaunchProgressPhase) => void;
}): Promise<RobinhoodLaunchResult> {
  const { form, sendTransaction, onPhase } = input;
  const creatorWallet = form.creatorWallet.trim();
  if (!creatorWallet) throw new Error("Connect your wallet first.");
  onPhase?.("preparing");
  const prepareRes = await fetch("/api/robinhood/prepare-launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
  const prepareData = (await prepareRes.json()) as {
    prepared?: PreparedRobinhoodLaunchTx;
    logo?: {
      gatewayUrl: string;
      originalUrl: string;
      ipfsCid: string;
      ipfsUri: string;
    };
    error?: string;
    code?: string;
  };
  if (!prepareRes.ok || !prepareData.prepared) {
    const err = new Error(prepareData.error || "Could not prepare launch");
    (err as Error & { code?: string }).code = prepareData.code;
    throw err;
  }
  const { prepared } = prepareData;
  if (prepared.signerWallet.toLowerCase() !== creatorWallet.toLowerCase()) {
    throw new Error("Wallet mismatch — reconnect and try again.");
  }
  if (prepared.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error("Prepared transaction is not for Robinhood Chain.");
  }
  onPhase?.("signing");
  const hash = await sendTransaction({
    chainId: ROBINHOOD_CHAIN_ID,
    account: creatorWallet as `0x${string}`,
    to: prepared.to as `0x${string}`,
    data: prepared.data as `0x${string}`,
    value: BigInt(prepared.value),
    gas: prepared.gasSuggestion ? BigInt(prepared.gasSuggestion) : undefined,
  });
  onPhase?.("indexing");
  const recordRes = await fetch("/api/robinhood/record-launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      txHash: hash,
      preparationId: prepared.preparationId,
    }),
  });
  const recordData = (await recordRes.json()) as {
    launch?: { tokenAddress: string };
    error?: string;
    code?: string;
  };
  if (!recordRes.ok || !recordData.launch) {
    const err = new Error(
      recordData.error || "Launch confirmed but indexing failed. Save your tx hash and try import.",
    );
    (err as Error & { code?: string }).code = recordData.code;
    (err as Error & { txHash?: string }).txHash = hash;
    throw err;
  }
  onPhase?.("done");
  return { tokenAddress: recordData.launch.tokenAddress, txHash: hash };
}
export function mapRobinhoodLaunchError(err: unknown): { message: string; code?: string; txHash?: string } {
  if (err instanceof Error && "code" in err) {
    const withMeta = err as Error & { code?: string; txHash?: string };
    return {
      message: err.message,
      code: typeof withMeta.code === "string" ? withMeta.code : undefined,
      txHash: typeof withMeta.txHash === "string" ? withMeta.txHash : undefined,
    };
  }
  const mapped = mapWalletError(err);
  return { message: mapped.message, code: mapped.code };
}