"use client";

import { x402Client } from "@x402/core/client";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import {
  INFERENCE_X402_ASSET,
  INFERENCE_X402_MAX_ATOMIC_USDC,
  INFERENCE_X402_NETWORK,
  isAllowedInferencePaymentRequirement,
  isExactApprovedX402Url,
} from "@/lib/inference-providers/x402-payment-policy";
import type { WalletClient } from "viem";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

export type X402PaymentNetwork = "base";

function exactApprovedFetch(approvedUrl: string): typeof fetch {
  if (!isExactApprovedX402Url(approvedUrl, approvedUrl)) {
    throw new Error("The approved x402 endpoint must be a credential-free HTTPS URL");
  }
  return async (input, init) => {
    const requested = input instanceof Request ? input.url : String(input);
    if (!isExactApprovedX402Url(requested, approvedUrl)) {
      throw new Error("The x402 payment client may only call its approved endpoint");
    }
    return fetch(input, {
      ...init,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  };
}

export function createInferencePaymentFetch(
  walletClient: WalletClient,
  approvedUrl: string,
): typeof fetch {
  const account = walletClient.account;
  if (!account?.address) throw new Error("Wallet account is not available.");
  const publicClient = createPublicClient({
    chain: base,
    transport: http(undefined, { timeout: 12_000, retryCount: 1, retryDelay: 250 }),
  });
  const evmSigner = toClientEvmSigner(
    {
      address: account.address,
      signTypedData: (message) =>
        walletClient.signTypedData({
          account,
          domain: message.domain as Parameters<WalletClient["signTypedData"]>[0]["domain"],
          types: message.types as Parameters<WalletClient["signTypedData"]>[0]["types"],
          primaryType: message.primaryType as Parameters<WalletClient["signTypedData"]>[0]["primaryType"],
          message: message.message as Parameters<WalletClient["signTypedData"]>[0]["message"],
        }),
    },
    publicClient,
  );
  const client = x402Client.fromConfig({
    schemes: [{ network: INFERENCE_X402_NETWORK, client: new ExactEvmScheme(evmSigner) }],
    // x402 2.23+ applies spend controls before custom policies. Mirror the
    // canonical Base-USDC cap here so the SDK and AgentRanking policy enforce
    // the same maximum even if x402's default-asset registry changes.
    spendControls: {
      allowedAssets: [
        {
          network: INFERENCE_X402_NETWORK,
          asset: INFERENCE_X402_ASSET,
          maxAmountPerPayment: INFERENCE_X402_MAX_ATOMIC_USDC.toString(),
        },
      ],
    },
    policies: [
      (version, requirements) =>
        requirements.filter((requirement) =>
          isAllowedInferencePaymentRequirement(version, requirement)),
    ],
  });
  return wrapFetchWithPayment(exactApprovedFetch(approvedUrl), client);
}
