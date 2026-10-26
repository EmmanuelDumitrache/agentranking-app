import { PublicKey } from "@solana/web3.js";
import { getSolanaWalletProvider, type SolanaInjectedProvider } from "@/lib/ar-token-ledger";
import { phantomFriendlyLocalUrl, phantomLocalConnectBlockedMessage } from "@/lib/phantom-localhost-hint";
export const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
export type InjectedWalletConnectErrorCode = "no_provider" | "timeout" | "cancelled" | "unknown";
export class InjectedWalletConnectError extends Error {
  readonly code: InjectedWalletConnectErrorCode;
  constructor(message: string, code: InjectedWalletConnectErrorCode) {
    super(message);
    this.name = "InjectedWalletConnectError";
    this.code = code;
  }
}
export type ConnectInjectedWalletOptions = {
  timeoutMs?: number;
  onlyIfTrustedFirst?: boolean;
};
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new InjectedWalletConnectError(timeoutMessage, "timeout"));
    }, timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
function mapConnectError(error: unknown): InjectedWalletConnectError {
  if (error instanceof InjectedWalletConnectError) return error;
  const message = error instanceof Error ? error.message : "Wallet connection failed.";
  const lowered = message.toLowerCase();
  if (
    lowered.includes("user rejected") ||
    lowered.includes("user denied") ||
    lowered.includes("rejected the request") ||
    lowered.includes("cancel")
  ) {
    return new InjectedWalletConnectError("Connection cancelled.", "cancelled");
  }
  return new InjectedWalletConnectError(message, "unknown");
}
function connectTimeoutMessage(): string {
  const friendly = phantomFriendlyLocalUrl();
  if (friendly) {
    return `Connection timed out on the alternate local host. Use ${friendly} instead.`;
  }
  return "Connection timed out — unlock Phantom, allow popups for this site, and try again.";
}
export async function connectInjectedWallet(
  opts?: ConnectInjectedWalletOptions,
): Promise<{ publicKey: PublicKey; provider: SolanaInjectedProvider }> {
  const provider = getSolanaWalletProvider();
  if (!provider) {
    throw new InjectedWalletConnectError(
      "Phantom extension was not detected. Install or open Phantom, then refresh this page.",
      "no_provider",
    );
  }
  if (provider.publicKey) {
    return { publicKey: provider.publicKey, provider };
  }
  const blocked = phantomLocalConnectBlockedMessage();
  if (blocked) {
    throw new InjectedWalletConnectError(blocked, "timeout");
  }
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const onlyIfTrustedFirst = opts?.onlyIfTrustedFirst ?? true;
  const attemptConnect = async (onlyIfTrusted: boolean) => {
    const res = await provider.connect({ onlyIfTrusted });
    return res.publicKey;
  };
  try {
    if (onlyIfTrustedFirst) {
      try {
        const publicKey = await withTimeout(attemptConnect(true), timeoutMs, connectTimeoutMessage());
        return { publicKey, provider };
      } catch (error) {
        if (error instanceof InjectedWalletConnectError && error.code === "timeout") {
          throw error;
        }
        // Trusted connect failed — fall through to interactive connect.
      }
    }
    const publicKey = await withTimeout(attemptConnect(false), timeoutMs, connectTimeoutMessage());
    return { publicKey, provider };
  } catch (error) {
    throw mapConnectError(error);
  }
}
export function subscribeInjectedWalletAccount(callbacks: {
  onAccountChange: (publicKey: PublicKey | null) => void;
  onDisconnect?: () => void;
}): () => void {
  const provider = getSolanaWalletProvider();
  if (!provider) return () => {};
  const accountHandler = () => callbacks.onAccountChange(provider.publicKey);
  const disconnectHandler = () => {
    callbacks.onAccountChange(null);
    callbacks.onDisconnect?.();
  };
  callbacks.onAccountChange(provider.publicKey);
  provider.on?.("accountChanged", accountHandler);
  provider.on?.("disconnect", disconnectHandler);
  return () => {
    provider.removeListener?.("accountChanged", accountHandler);
    provider.removeListener?.("disconnect", disconnectHandler);
  };
}