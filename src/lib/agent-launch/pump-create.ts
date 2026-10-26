import "server-only";
import BN from "bn.js";
import {
  getBuyTokenAmountFromSolAmount,
  OnlinePumpSdk,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAgentLaunchLatestBlockhash,
  getAgentLaunchNetwork,
  withAgentLaunchReadRpc,
} from "@/lib/agent-launch/solana";
import type { AgentLaunchNetwork } from "@/lib/agent-launch/network";
const PUMP_URI_MAX_LENGTH = 200;
export type BuildCreateTxInput = {
  creatorWallet: PublicKey;
  mint: PublicKey;
  treasury: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  creationFeeLamports: bigint;
  initialBuyLamports: bigint;
};
export type BuildCreateTxResult = {
  transactionBase64: string;
  mint: string;
  network: AgentLaunchNetwork;
  pumpCreateIncluded: boolean;
  initialBuyIncluded: boolean;
  warnings: string[];
  requiresSigners: string[];
};
function truncateUri(uri: string): string {
  const trimmed = uri.trim();
  if (trimmed.length <= PUMP_URI_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, PUMP_URI_MAX_LENGTH);
}
async function serializeTransaction(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
): Promise<string> {
  const { blockhash } = await getAgentLaunchLatestBlockhash(getAgentLaunchNetwork());
  const tx = new Transaction();
  for (const ix of instructions) tx.add(ix);
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  return Buffer.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString("base64");
}
async function buildCreationFeeTransferInstruction(
  creator: PublicKey,
  treasury: PublicKey,
  lamports: bigint,
): Promise<TransactionInstruction> {
  return SystemProgram.transfer({
    fromPubkey: creator,
    toPubkey: treasury,
    lamports: Number(lamports),
  });
}
export async function buildAgentLaunchCreateTransaction(
  input: BuildCreateTxInput,
): Promise<BuildCreateTxResult> {
  const warnings: string[] = [];
  const network = getAgentLaunchNetwork();
  const platformFeeInstructions: TransactionInstruction[] = [];
  if (input.creationFeeLamports > BigInt(0)) {
    platformFeeInstructions.push(
      await buildCreationFeeTransferInstruction(
        input.creatorWallet,
        input.treasury,
        input.creationFeeLamports,
      ),
    );
  }
  let pumpInstructions: TransactionInstruction[] = [];
  let pumpCreateIncluded = false;
  let initialBuyIncluded = false;
  try {
    const global = await withAgentLaunchReadRpc((connection) =>
      new OnlinePumpSdk(connection).fetchGlobal(),
    );
    const feeConfig = await withAgentLaunchReadRpc((connection) =>
      new OnlinePumpSdk(connection).fetchFeeConfig(),
    ).catch(() => null);
    const uri = truncateUri(input.uri || `mock://metadata/${input.mint.toBase58()}`);
    if (input.initialBuyLamports > BigInt(0)) {
      const solAmount = new BN(input.initialBuyLamports.toString());
      const tokenAmount = getBuyTokenAmountFromSolAmount({
        global,
        feeConfig,
        mintSupply: null,
        bondingCurve: null,
        amount: solAmount,
        quoteMint: NATIVE_MINT,
      });
      pumpInstructions = await PUMP_SDK.createV2AndBuyInstructions({
        global,
        mint: input.mint,
        name: input.name,
        symbol: input.symbol,
        uri,
        creator: input.creatorWallet,
        user: input.creatorWallet,
        amount: tokenAmount,
        solAmount,
        mayhemMode: false,
        cashback: false,
      });
      initialBuyIncluded = true;
    } else {
      pumpInstructions = [
        await PUMP_SDK.createV2Instruction({
          mint: input.mint,
          name: input.name,
          symbol: input.symbol,
          uri,
          creator: input.creatorWallet,
          user: input.creatorWallet,
          mayhemMode: false,
          cashback: false,
        }),
      ];
    }
    pumpCreateIncluded = true;
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    warnings.push(`Pump create_v2 wiring incomplete: ${message}`);
    warnings.push(
      "Returning without Pump instructions. Token will not be created until Pump instructions succeed.",
    );
  }
  const instructions = [...platformFeeInstructions, ...pumpInstructions];
  const transactionBase64 = await serializeTransaction(
    instructions,
    input.creatorWallet,
  );
  return {
    transactionBase64,
    mint: input.mint.toBase58(),
    network,
    pumpCreateIncluded,
    initialBuyIncluded,
    warnings,
    requiresSigners: [input.creatorWallet.toBase58(), input.mint.toBase58()],
  };
}
