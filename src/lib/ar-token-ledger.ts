import { PublicKey, Transaction } from "@solana/web3.js";
export function trySolanaPublicKey(address: string): PublicKey | null {
  try {
    return new PublicKey(address.trim());
  } catch {
    return null;
  }
}
export function isValidSolanaMintString(address: string): boolean {
  return trySolanaPublicKey(address) !== null;
}
export type SolanaInjectedProvider = {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  signAndSendTransaction?: (transaction: Transaction) => Promise<{ signature: string } | string>;
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
};
export function getSolanaWalletProvider(): SolanaInjectedProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & { solana?: SolanaInjectedProvider; phantom?: { solana?: SolanaInjectedProvider } };
  const candidates = [w.phantom?.solana, w.solana].filter(Boolean) as SolanaInjectedProvider[];
  return candidates.find((p) => p.isPhantom) ?? candidates[0];
}