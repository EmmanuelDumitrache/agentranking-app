import type { LaunchWalletChain } from "@/lib/launch-wallet-session/constants";

export const LAUNCH_WALLET_SESSION_PREFIX = "AgentRanking launch session\n\n";

export function buildLaunchWalletSessionMessage(input: {
  chain: LaunchWalletChain;
  wallet: string;
  nonce: string;
  issuedAtIso?: string;
}): string {
  const issued = input.issuedAtIso ?? new Date().toISOString();
  return `${LAUNCH_WALLET_SESSION_PREFIX}Chain: ${input.chain}\nWallet: ${input.wallet.trim()}\nNonce: ${input.nonce}\nIssued At: ${issued}`;
}

export function parseLaunchWalletSessionMessage(
  message: string,
): { chain: LaunchWalletChain; wallet: string; nonce: string; issuedMs: number } | null {
  if (!message.startsWith(LAUNCH_WALLET_SESSION_PREFIX)) return null;

  const chainMatch = message.match(/^Chain:\s*(solana|evm)\s*$/m);
  const walletMatch = message.match(/^Wallet:\s*(.+)\s*$/m);
  const nonceMatch = message.match(/^Nonce:\s*(.+)\s*$/m);
  const issuedMatch = message.match(/Issued At:\s*(.+)/i);

  if (!chainMatch || !walletMatch || !nonceMatch || !issuedMatch) return null;

  const issuedMs = Date.parse(issuedMatch[1].trim());
  if (!Number.isFinite(issuedMs)) return null;

  return {
    chain: chainMatch[1] as LaunchWalletChain,
    wallet: walletMatch[1].trim(),
    nonce: nonceMatch[1].trim(),
    issuedMs,
  };
}
