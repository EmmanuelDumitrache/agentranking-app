import type { DepositConfig } from "./types";
import { isValidSolanaPublicKey } from "@/lib/custodial-wallet/validate";
export type ResolvedRecipient = {
  walletId: string | null;
  publicKey: string;
  recipientType: "ACCOUNT_WALLET" | "TREASURY_WALLET";
};
export function resolveDepositRecipient(params: {
  config: DepositConfig;
  accountWallet?: { id: string; publicKey: string } | null;
}): ResolvedRecipient {
  const { config, accountWallet } = params;
  if (config.treasuryWallet) {
    if (isValidSolanaPublicKey(config.treasuryWallet)) {
      return {
        walletId: null,
        publicKey: config.treasuryWallet,
        recipientType: "TREASURY_WALLET",
      };
    }
    throw new Error(
      `treasuryWallet "${config.treasuryWallet}" is not a valid Solana public key`,
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "treasuryWallet is required in production",
    );
  }
  if (accountWallet) {
    return {
      walletId: accountWallet.id,
      publicKey: accountWallet.publicKey,
      recipientType: "ACCOUNT_WALLET",
    };
  }
  throw new Error(
    "account wallet is required when treasuryWallet is not configured",
  );
}