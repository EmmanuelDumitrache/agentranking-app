import "server-only";
import { feeSharingConfigPda, PUMP_SDK } from "@pump-fun/pump-sdk";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { getAgentLaunchConnection, getAgentLaunchNetwork } from "@/lib/agent-launch/solana";
import type { AgentLaunchNetwork } from "@/lib/agent-launch/network";
export type FeeShareRecipient = {
  wallet: string;
  bps: number;
};
export type BuildFeeShareTxInput = {
  creatorWallet: PublicKey;
  mint: PublicKey;
  treasury: PublicKey;
  creatorShareBps: number;
  arShareBps: number;
};
export type BuildFeeShareTxResult = {
  transactionBase64: string;
  sharingConfig: string;
  shares: FeeShareRecipient[];
  network: AgentLaunchNetwork;
  feeSharingWired: boolean;
  warnings: string[];
};
async function serializeFeeShareTransaction(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
): Promise<string> {
  const connection = getAgentLaunchConnection();
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction();
  for (const ix of instructions) tx.add(ix);
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  return Buffer.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString("base64");
}
export async function buildAgentLaunchFeeShareTransaction(
  input: BuildFeeShareTxInput,
): Promise<BuildFeeShareTxResult> {
  const sharingConfig = feeSharingConfigPda(input.mint);
  const shares: FeeShareRecipient[] = [
    { wallet: input.creatorWallet.toBase58(), bps: input.creatorShareBps },
    { wallet: input.treasury.toBase58(), bps: input.arShareBps },
  ];
  const network = getAgentLaunchNetwork();
  const warnings: string[] = [];
  const connection = getAgentLaunchConnection();
  const sharingConfigInfo = await connection.getAccountInfo(sharingConfig);
  const instructions: TransactionInstruction[] = [];
  try {
    if (!sharingConfigInfo) {
      instructions.push(
        await PUMP_SDK.createFeeSharingConfig({
          creator: input.creatorWallet,
          mint: input.mint,
          pool: null,
        }),
      );
    }
    const currentShareholders = sharingConfigInfo
      ? PUMP_SDK.decodeSharingConfig(sharingConfigInfo).shareholders.map(
          (s) => s.address,
        )
      : [input.creatorWallet];
    instructions.push(
      await PUMP_SDK.updateFeeSharesV2({
        authority: input.creatorWallet,
        mint: input.mint,
        currentShareholders,
        newShareholders: [
          { address: input.creatorWallet, shareBps: input.creatorShareBps },
          { address: input.treasury, shareBps: input.arShareBps },
        ],
        quoteMint: NATIVE_MINT,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
      }),
    );
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    warnings.push(`Pump fee-sharing wiring incomplete: ${message}`);
    return {
      transactionBase64: "",
      sharingConfig: sharingConfig.toBase58(),
      shares,
      network,
      feeSharingWired: false,
      warnings,
    };
  }
  const transactionBase64 = await serializeFeeShareTransaction(
    instructions,
    input.creatorWallet,
  );
  return {
    transactionBase64,
    sharingConfig: sharingConfig.toBase58(),
    shares,
    network,
    feeSharingWired: true,
    warnings,
  };
}
export async function fetchOnChainFeeShareConfig(mint: PublicKey) {
  const connection = getAgentLaunchConnection();
  const sharingConfigPk = feeSharingConfigPda(mint);
  const info = await connection.getAccountInfo(sharingConfigPk);
  if (!info) return null;
  return {
    address: sharingConfigPk.toBase58(),
    config: PUMP_SDK.decodeSharingConfig(info),
  };
}
