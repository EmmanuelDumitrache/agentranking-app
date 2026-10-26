import { Connection, PublicKey } from "@solana/web3.js";
import { createPublicClient, decodeEventLog, formatEther, formatUnits, http, isAddress, parseAbiItem, parseUnits, type PublicClient } from "viem";
import { mainnet, sepolia } from "viem/chains";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { allowClientTestnetFromServer, isPromotionTestModeEnabled } from "@/lib/env-deploy";
import { resolveSolanaRpcUrl } from "@/lib/solana-rpc-url";
const TX_EXPIRY_MS = 24 * 60 * 60 * 1_000;
const ERC20_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
export type PaymentToken = "ETH" | "USDC" | "SOL";
interface VerifyResult {
  valid: true;
  paidAmount: string;
  currency: string;
  paymentToken: PaymentToken;
  transactionId: string;
  payerWallet: string;
}
export function isTestMode(): boolean {
  return isPromotionTestModeEnabled();
}
function resolveTestMode(clientTestnet?: boolean): boolean {
  if (isTestMode()) return true;
  return Boolean(clientTestnet && allowClientTestnetFromServer());
}
const TEST_AMOUNTS: Record<string, Record<PaymentToken, Record<number, string>>> = {
  hot: {
    ETH: { 1: "0.00001", 2: "0.000015", 7: "0.00005", 14: "0.00008", 30: "0.00012" },
    USDC: { 1: "0.025", 2: "0.035", 7: "0.1", 14: "0.16", 30: "0.24" },
    SOL: { 1: "0.00015", 2: "0.00022", 7: "0.0008", 14: "0.0012", 30: "0.0018" },
  },
  featured: {
    ETH: { 1: "0.00002", 2: "0.00003", 7: "0.0001", 14: "0.00016", 30: "0.00025" },
    USDC: { 1: "0.05", 2: "0.07", 7: "0.2", 14: "0.32", 30: "0.5" },
    SOL: { 1: "0.0003", 2: "0.00045", 7: "0.0016", 14: "0.0025", 30: "0.004" },
  },
  custom_listing: {
    ETH: { 7: "0.00005" },
    USDC: { 7: "0.005" },
    SOL: { 7: "0.0005" },
  },
  premium_verify: {
    ETH: { 7: "0.00005" },
    USDC: { 7: "0.005" },
    SOL: { 7: "0.0005" },
  },
  banner_ad: {
    ETH: { 1: "0.000015" },
    USDC: { 1: "0.03" },
    SOL: { 1: "0.00023" },
  },
};
export function getTestPrices(): Record<string, Record<string, Record<number, string>>> {
  const prices: Record<string, Record<string, Record<number, string>>> = {};
  const keyMap: Record<PaymentToken, string> = { ETH: "eth_base", USDC: "usdc_base", SOL: "sol" };
  for (const [slotType, tokenMap] of Object.entries(TEST_AMOUNTS)) {
    prices[slotType] = {};
    for (const [currency, durationMap] of Object.entries(tokenMap)) {
      prices[slotType][keyMap[currency as PaymentToken]] = durationMap;
    }
  }
  return prices;
}
function getEvmTreasury(): string | null {
  const value = process.env.TREASURY_ADDRESS_EVM?.trim() || process.env.PROMOTION_TREASURY_ADDRESS?.trim();
  if (!value) return null;
  if (!isAddress(value)) throw new Error("EVM treasury address is invalid");
  return value.toLowerCase();
}
function getSolanaTreasury(): string | null {
  const value =
    process.env.SOLANA_TREASURY_ADDRESS?.trim() ||
    process.env.LLM_DEPOSIT_TREASURY_ADDRESS?.trim() ||
    process.env.LLM_CREDIT_TREASURY_SOLANA_WALLET?.trim();
  if (!value) return null;
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error("Solana treasury address is invalid");
  }
}
function getUsdcContract(testMode: boolean): `0x${string}` {
  const value = testMode
    ? process.env.USDC_CONTRACT_ETHEREUM_SEPOLIA || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
    : process.env.USDC_CONTRACT_ETHEREUM || "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  if (!isAddress(value)) throw new Error("USDC contract address is invalid");
  return value.toLowerCase() as `0x${string}`;
}
function getInfuraUrl(network: string): string | undefined {
  const key = process.env.INFURA_API_KEY?.trim();
  return key ? `https://${network}.infura.io/v3/${key}` : undefined;
}
function getEthClient(testMode: boolean): PublicClient {
  const configured = testMode
    ? process.env.ETHEREUM_SEPOLIA_RPC_URL?.trim() || getInfuraUrl("sepolia")
    : process.env.ETHEREUM_RPC_URL?.trim() || getInfuraUrl("mainnet");
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error(testMode ? "ETHEREUM_SEPOLIA_RPC_URL is not configured" : "ETHEREUM_RPC_URL is not configured");
  }
  const rpcUrl = configured || (testMode ? "https://rpc2.sepolia.org" : "https://ethereum.publicnode.com");
  return createPublicClient({
    chain: testMode ? sepolia : mainnet,
    transport: http(rpcUrl, { timeout: 15_000, retryCount: 2, retryDelay: 500 }),
  }) as PublicClient;
}
function assertNotExpired(timestampSec: number): void {
  if (!Number.isFinite(timestampSec) || timestampSec <= 0) {
    throw new Error("Transaction block timestamp is unavailable");
  }
  const ageMs = Date.now() - timestampSec * 1_000;
  if (ageMs < -5 * 60_000) throw new Error("Transaction timestamp is in the future");
  if (ageMs > TX_EXPIRY_MS) {
    throw new Error(`Transaction is older than ${TX_EXPIRY_MS / 3_600_000} hours`);
  }
}
function normalizeWallet(token: PaymentToken, wallet: string): string {
  const value = wallet.trim();
  if (token === "SOL") {
    try {
      return new PublicKey(value).toBase58();
    } catch {
      throw new Error("Invalid Solana wallet address");
    }
  }
  if (!isAddress(value)) throw new Error("Invalid EVM wallet address");
  return value.toLowerCase();
}
export function paymentWalletsEqual(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (isAddress(a) && isAddress(b)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}
export function normalizePaymentTransactionId(token: PaymentToken, value: string): string {
  const trimmed = value.trim();
  if (token === "SOL") {
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(trimmed)) throw new Error("Invalid Solana transaction signature");
    return trimmed;
  }
  const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) throw new Error("Invalid EVM transaction hash");
  return normalized.toLowerCase();
}
function positiveAtomicAmount(value: string, decimals: number, label: string): bigint {
  let amount: bigint;
  try {
    amount = parseUnits(value.trim(), decimals);
  } catch {
    throw new Error(`Invalid ${label} amount`);
  }
  if (amount <= 0n) throw new Error(`${label} amount must be positive`);
  return amount;
}
/** Multiply a decimal payment rate using atomic units instead of floating-point arithmetic. */
export function multiplyPaymentAmount(
  perUnitAmount: string,
  multiplier: number,
  token: PaymentToken,
): string {
  if (!Number.isSafeInteger(multiplier) || multiplier <= 0) {
    throw new Error("Payment amount multiplier must be a positive integer");
  }
  const decimals = token === "ETH" ? 18 : token === "USDC" ? 6 : 9;
  const atomic = positiveAtomicAmount(perUnitAmount, decimals, token) * BigInt(multiplier);
  return formatUnits(atomic, decimals);
}
function minimumEvmConfirmations(testMode: boolean): number {
  const parsed = Number.parseInt(process.env.PAYMENT_EVM_CONFIRMATIONS ?? (testMode ? "1" : "2"), 10);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(parsed, 64)) : (testMode ? 1 : 2);
}
async function assertEvmFinality(
  client: PublicClient,
  receipt: { blockNumber: bigint; status: "success" | "reverted" },
  testMode: boolean,
): Promise<void> {
  if (receipt.status !== "success") throw new Error("Transaction reverted on-chain");
  const latest = await client.getBlockNumber();
  const confirmations = latest >= receipt.blockNumber ? Number(latest - receipt.blockNumber + 1n) : 0;
  const required = minimumEvmConfirmations(testMode);
  if (confirmations < required) {
    throw new Error(`Transaction requires ${required} confirmation${required === 1 ? "" : "s"}; currently ${confirmations}`);
  }
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  assertNotExpired(Number(block.timestamp));
}
async function verifyEthPayment(
  txHash: string,
  expectedAmount: string,
  wallet: string,
  testMode: boolean,
): Promise<void> {
  const treasury = getEvmTreasury();
  if (!treasury) throw new Error("EVM treasury address not configured");
  const client = getEthClient(testMode);
  const hash = txHash as `0x${string}`;
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);
  await assertEvmFinality(client, receipt, testMode);
  if ((transaction.to ?? "").toLowerCase() !== treasury) {
    throw new Error(`Payment must be sent to ${treasury}`);
  }
  if (transaction.from.toLowerCase() !== wallet) {
    throw new Error("Payment must be sent from your connected wallet");
  }
  const requiredWei = positiveAtomicAmount(expectedAmount, 18, "ETH");
  if (transaction.value < requiredWei) {
    throw new Error(`Payment must be at least ${expectedAmount} ETH. Got ${formatEther(transaction.value)} ETH`);
  }
}
async function verifyUsdcPayment(
  txHash: string,
  expectedAmount: string,
  wallet: string,
  testMode: boolean,
): Promise<void> {
  const treasury = getEvmTreasury();
  if (!treasury) throw new Error("EVM treasury address not configured");
  const client = getEthClient(testMode);
  const hash = txHash as `0x${string}`;
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);
  await assertEvmFinality(client, receipt, testMode);
  if (transaction.from.toLowerCase() !== wallet) {
    throw new Error("Payment transaction must be sent by your connected wallet");
  }
  const contract = getUsdcContract(testMode);
  const required = positiveAtomicAmount(expectedAmount, 6, "USDC");
  let transferred = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract) continue;
    try {
      const decoded = decodeEventLog({ abi: [ERC20_TRANSFER_EVENT], data: log.data, topics: log.topics, strict: true });
      const args = decoded.args as { from: string; to: string; value: bigint };
      if (args.from.toLowerCase() === wallet && args.to.toLowerCase() === treasury) {
        transferred += args.value;
      }
    } catch {
      // Ignore non-Transfer logs emitted by the USDC contract.
    }
  }
  if (transferred < required) {
    throw new Error(`Payment must transfer at least ${expectedAmount} USDC from the connected wallet to ${treasury}. Got ${formatUnits(transferred, 6)} USDC`);
  }
}
async function verifySolPayment(txHash: string, expectedAmount: string, wallet: string): Promise<void> {
  const treasury = getSolanaTreasury();
  if (!treasury) throw new Error("Solana treasury address not configured");
  if (process.env.NODE_ENV === "production" && !process.env.SOLANA_RPC_URL?.trim()) {
    throw new Error("SOLANA_RPC_URL is not configured");
  }
  const connection = new Connection(resolveSolanaRpcUrl(), { commitment: "finalized", confirmTransactionInitialTimeout: 15_000 });
  const [statusResult, transaction] = await Promise.all([
    connection.getSignatureStatuses([txHash], { searchTransactionHistory: true }),
    connection.getParsedTransaction(txHash, { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
  ]);
  const status = statusResult.value[0];
  if (!status || status.err || status.confirmationStatus !== "finalized") {
    throw new Error("SOL transaction is not finalized successfully");
  }
  if (!transaction || transaction.meta?.err) throw new Error("SOL transaction failed or is unavailable");
  const keys = transaction.transaction.message.accountKeys;
  const treasuryIndex = keys.findIndex((key) => key.pubkey.toBase58() === treasury);
  const walletIndex = keys.findIndex((key) => key.pubkey.toBase58() === wallet && key.signer);
  if (treasuryIndex < 0) throw new Error(`SOL must be sent to ${treasury}`);
  if (walletIndex < 0) throw new Error("Payment must be signed by your connected wallet");
  const preTreasury = transaction.meta?.preBalances[treasuryIndex];
  const postTreasury = transaction.meta?.postBalances[treasuryIndex];
  const preWallet = transaction.meta?.preBalances[walletIndex];
  const postWallet = transaction.meta?.postBalances[walletIndex];
  if ([preTreasury, postTreasury, preWallet, postWallet].some((value) => value === undefined)) {
    throw new Error("SOL transaction balance data is incomplete");
  }
  const received = BigInt(postTreasury!) - BigInt(preTreasury!);
  const spent = BigInt(preWallet!) - BigInt(postWallet!);
  const required = positiveAtomicAmount(expectedAmount, 9, "SOL");
  if (received < required || spent < required) {
    throw new Error(`Payment must transfer at least ${expectedAmount} SOL from the connected wallet to ${treasury}. Got ${formatUnits(received > 0n ? received : 0n, 9)} SOL`);
  }
  assertNotExpired(transaction.blockTime ?? 0);
}
type PaymentLookupClient = Pick<
  Prisma.TransactionClient,
  "promotion" | "adOrder" | "adOrderStrip" | "adOrderSquare" | "agentBoost" | "order"
>;
async function assertTransactionUnusedWithClient(
  db: PaymentLookupClient,
  transactionId: string,
  token: PaymentToken,
): Promise<void> {
  const filter = token === "SOL"
    ? { equals: transactionId }
    : { equals: transactionId, mode: "insensitive" as const };
  const [promotion, ad, strip, square, boost, order] = await Promise.all([
    db.promotion.findFirst({ where: { txHash: filter }, select: { id: true } }),
    db.adOrder.findFirst({ where: { txHash: filter }, select: { id: true } }),
    db.adOrderStrip.findFirst({ where: { txHash: filter }, select: { id: true } }),
    db.adOrderSquare.findFirst({ where: { txHash: filter }, select: { id: true } }),
    db.agentBoost.findFirst({ where: { txHash: filter }, select: { id: true } }),
    db.order.findFirst({ where: { txHash: filter }, select: { id: true } }),
  ]);
  if (promotion || ad || strip || square || boost || order) {
    throw new Error("This transaction has already been used");
  }
}
async function assertTransactionUnused(transactionId: string, token: PaymentToken): Promise<void> {
  await assertTransactionUnusedWithClient(prisma, transactionId, token);
}
/**
 * Serialize the final database claim across every payment product, then recheck
 * all payment placement tables while the transaction-scoped advisory lock is held.
 */
export async function claimPaymentTransactionInTx(
  tx: Prisma.TransactionClient,
  transactionId: string,
  token: PaymentToken,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-transaction:${transactionId}`}, 0))`;
  await assertTransactionUnusedWithClient(tx, transactionId, token);
}
export async function verifyPayment(
  paymentToken: string,
  txHash: string,
  slotType: string,
  wallet: string,
  durationDays = 7,
  clientTestnet = false,
  expectedAmountOverride?: string,
): Promise<VerifyResult> {
  const token = paymentToken.toUpperCase() as PaymentToken;
  if (!(["ETH", "USDC", "SOL"] as const).includes(token)) {
    throw new Error("paymentToken must be ETH, USDC, or SOL");
  }
  const transactionId = normalizePaymentTransactionId(token, txHash);
  const normalizedWallet = normalizeWallet(token, wallet);
  const testMode = resolveTestMode(clientTestnet);
  let expectedAmount: string;
  if (expectedAmountOverride?.trim()) {
    expectedAmount = expectedAmountOverride.trim();
  } else if (testMode) {
    const resolved = TEST_AMOUNTS[slotType]?.[token]?.[durationDays];
    if (!resolved) throw new Error(`No test price configured for ${slotType} / ${token} / ${durationDays}d`);
    expectedAmount = resolved;
  } else {
    const priceRow = await prisma.promotionPrice.findUnique({
      where: { slotType_currency_durationDays: { slotType, currency: token, durationDays } },
    });
    if (!priceRow) throw new Error(`No price configured for ${slotType} / ${token} / ${durationDays}d`);
    expectedAmount = priceRow.amount;
  }
  const decimals = token === "ETH" ? 18 : token === "USDC" ? 6 : 9;
  positiveAtomicAmount(expectedAmount, decimals, token);
  await assertTransactionUnused(transactionId, token);
  if (token === "ETH") await verifyEthPayment(transactionId, expectedAmount, normalizedWallet, testMode);
  if (token === "USDC") await verifyUsdcPayment(transactionId, expectedAmount, normalizedWallet, testMode);
  if (token === "SOL") await verifySolPayment(transactionId, expectedAmount, normalizedWallet);
  return {
    valid: true,
    paidAmount: expectedAmount,
    currency: token,
    paymentToken: token,
    transactionId,
    payerWallet: normalizedWallet,
  };
}
export function getTreasuryAddresses() {
  return { evm: getEvmTreasury(), sol: getSolanaTreasury() };
}
