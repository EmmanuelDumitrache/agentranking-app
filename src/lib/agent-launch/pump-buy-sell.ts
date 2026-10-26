import "server-only";
import BN from "bn.js";
import {
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
  OnlinePumpSdk,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getAgentLaunchConnection } from "@/lib/agent-launch/solana";
import { serializeAgentLaunchTransaction } from "@/lib/agent-launch/transaction";
export type BuildBuyTxResult = {
  transactionBase64: string;
  mint: string;
  buyerWallet: string;
  network: "devnet";
  buyWired: boolean;
  warnings: string[];
};
export type BuildSellTxResult = {
  transactionBase64: string;
  mint: string;
  sellerWallet: string;
  network: "devnet";
  sellWired: boolean;
  warnings: string[];
};
function slippageSdkUnits(slippageBps: number): number {
  return Math.max(0, Math.floor(slippageBps / 100));
}
export async function buildTestBuyTransaction(input: {
  mint: PublicKey;
  buyerWallet: PublicKey;
  quoteLamports: bigint;
  slippageBps: number;
}): Promise<BuildBuyTxResult> {
  const warnings: string[] = [];
  const connection = getAgentLaunchConnection();
  const onlineSdk = new OnlinePumpSdk(connection);
  try {
    const global = await onlineSdk.fetchGlobal();
    const feeConfig = await onlineSdk.fetchFeeConfig().catch(() => null);
    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
      await onlineSdk.fetchBuyState(input.mint, input.buyerWallet, TOKEN_2022_PROGRAM_ID);
    if (bondingCurve.complete) {
      throw new Error("Bonding curve complete — use AMM flow (not wired in MVP)");
    }
    const quoteAmount = new BN(input.quoteLamports.toString());
    const tokenAmount = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount: quoteAmount,
      quoteMint: NATIVE_MINT,
    });
    const instructions = await PUMP_SDK.buyV2Instructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      associatedUserAccountInfo,
      mint: input.mint,
      user: input.buyerWallet,
      amount: tokenAmount,
      quoteAmount,
      slippage: slippageSdkUnits(input.slippageBps),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    });
    const transactionBase64 = await serializeAgentLaunchTransaction(
      instructions,
      input.buyerWallet,
    );
    return {
      transactionBase64,
      mint: input.mint.toBase58(),
      buyerWallet: input.buyerWallet.toBase58(),
      network: "devnet",
      buyWired: true,
      warnings,
    };
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    warnings.push(`Pump buy_v2 wiring incomplete: ${message}`);
    return {
      transactionBase64: "",
      mint: input.mint.toBase58(),
      buyerWallet: input.buyerWallet.toBase58(),
      network: "devnet",
      buyWired: false,
      warnings,
    };
  }
}
export async function buildTestSellTransaction(input: {
  mint: PublicKey;
  sellerWallet: PublicKey;
  baseAmount: bigint;
  slippageBps: number;
}): Promise<BuildSellTxResult> {
  const warnings: string[] = [];
  const connection = getAgentLaunchConnection();
  const onlineSdk = new OnlinePumpSdk(connection);
  try {
    const global = await onlineSdk.fetchGlobal();
    const feeConfig = await onlineSdk.fetchFeeConfig().catch(() => null);
    const { bondingCurveAccountInfo, bondingCurve } = await onlineSdk.fetchSellState(
      input.mint,
      input.sellerWallet,
      TOKEN_2022_PROGRAM_ID,
    );
    const amount = new BN(input.baseAmount.toString());
    const quoteAmount = getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount,
    });
    const instructions = await PUMP_SDK.sellV2Instructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      mint: input.mint,
      user: input.sellerWallet,
      amount,
      quoteAmount,
      slippage: slippageSdkUnits(input.slippageBps),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    });
    const transactionBase64 = await serializeAgentLaunchTransaction(
      instructions,
      input.sellerWallet,
    );
    return {
      transactionBase64,
      mint: input.mint.toBase58(),
      sellerWallet: input.sellerWallet.toBase58(),
      network: "devnet",
      sellWired: true,
      warnings,
    };
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    warnings.push(`Pump sell_v2 wiring incomplete: ${message}`);
    return {
      transactionBase64: "",
      mint: input.mint.toBase58(),
      sellerWallet: input.sellerWallet.toBase58(),
      network: "devnet",
      sellWired: false,
      warnings,
    };
  }
}
export async function fetchInvestorTokenBalanceRaw(
  mint: PublicKey,
  owner: PublicKey,
): Promise<bigint> {
  const connection = getAgentLaunchConnection();
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
  try {
    const balance = await connection.getTokenAccountBalance(ata);
    return BigInt(balance.value.amount);
  } catch {
    return BigInt(0);
  }
}
