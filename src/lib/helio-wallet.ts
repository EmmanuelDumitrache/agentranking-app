import { PublicKey } from "@solana/web3.js";
import { getAddress, isAddress } from "viem";

type HelioPayloadContainer = {
  metadata?: Record<string, unknown>;
  walletAddress?: string;
  wallet?: string;
  customerWallet?: string;
  senderPK?: string;
  from?: string;
  meta?: {
    senderPK?: string;
    customerDetails?: { walletAddress?: string };
  };
};

/** Pull and canonicalize the payer wallet from current or legacy Helio webhook payloads. */
export function extractWalletFromHelioPayload(event: {
  data?: HelioPayloadContainer;
  transactionObject?: HelioPayloadContainer;
}): string | null {
  const transaction = event.transactionObject;
  const data = event.data;
  const metadata = data?.metadata;
  const fromMetadata = metadata && typeof metadata === "object"
    ? (metadata.walletAddress ?? metadata.wallet ?? metadata.connectedWallet ?? metadata.payerWallet)
    : undefined;
  const raw = [
    fromMetadata,
    data?.walletAddress,
    data?.wallet,
    data?.customerWallet,
    data?.senderPK,
    transaction?.walletAddress,
    transaction?.wallet,
    transaction?.customerWallet,
    transaction?.senderPK,
    transaction?.from,
    transaction?.meta?.senderPK,
    transaction?.meta?.customerDetails?.walletAddress,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const value = raw?.trim() ?? "";
  if (!value) return null;
  if (isAddress(value)) {
    try {
      return getAddress(value as `0x${string}`).toLowerCase();
    } catch {
      return null;
    }
  }
  try {
    return new PublicKey(value).toBase58();
  } catch {
    return null;
  }
}
