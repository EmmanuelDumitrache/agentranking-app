import "server-only";
import { createWalletClient, http, type Chain, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { bytesToHex } from "viem";
import { mainnet } from "viem/chains";
import { prisma } from "@/lib/db";
import { decryptSecretBytes } from "@/lib/custodial-wallet/crypto";
import {
  ROBINHOOD_CHAIN_CONFIG,
  ROBINHOOD_CHAIN_ID,
  robinhoodChain,
} from "@/lib/robinhood-chain/config";
const ETHEREUM_MAINNET_RPC =
  process.env.ETHEREUM_MAINNET_RPC_URL?.trim() || "https://ethereum.publicnode.com";
function resolveCustodialEvmChain(chainId?: number): { chain: Chain; rpcUrl: string } {
  if (chainId == null || chainId === ROBINHOOD_CHAIN_ID) {
    return { chain: robinhoodChain, rpcUrl: ROBINHOOD_CHAIN_CONFIG.rpcUrl };
  }
  if (chainId === mainnet.id) {
    return { chain: mainnet, rpcUrl: ETHEREUM_MAINNET_RPC };
  }
  throw new Error(`Unsupported EVM chain for custodial send: ${chainId}`);
}
type CustodialEvmSecretRow = {
  encrypted_secret: string;
  public_key: string;
};
export async function loadAgentCustodialEvmAccount(
  agentDbId: number,
): Promise<PrivateKeyAccount | null> {
  const rows = await prisma.$queryRaw<CustodialEvmSecretRow[]>`
    SELECT cw.encrypted_secret, cw.public_key
    FROM "Agent" a
    INNER JOIN custodial_wallets cw ON cw.id = a.agent_evm_wallet_id
    WHERE a.id = ${agentDbId}
      AND a.evm_wallet_status = 'active'
      AND a.evm_wallet_provider = 'custodial'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.encrypted_secret) return null;
  const secret = decryptSecretBytes(row.encrypted_secret);
  const privateKey = bytesToHex(secret) as Hex;
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== row.public_key.toLowerCase()) {
    throw new Error("Custodial EVM key does not match stored address.");
  }
  return account;
}
export async function signAndSendAgentCustodialEvmTransaction(input: {
  agentDbId: number;
  to: Hex;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
  expectedAddress?: string;
  chainId?: number;
}): Promise<Hex> {
  const account = await loadAgentCustodialEvmAccount(input.agentDbId);
  if (!account) {
    throw new Error("Agent EVM wallet signing is not available for this agent.");
  }
  if (
    input.expectedAddress &&
    account.address.toLowerCase() !== input.expectedAddress.trim().toLowerCase()
  ) {
    throw new Error("Agent EVM wallet does not match the expected signer.");
  }
  const { chain, rpcUrl } = resolveCustodialEvmChain(input.chainId);
  const client = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  return client.sendTransaction({
    chain,
    to: input.to,
    data: input.data,
    value: input.value ?? BigInt(0),
    gas: input.gas,
  });
}
