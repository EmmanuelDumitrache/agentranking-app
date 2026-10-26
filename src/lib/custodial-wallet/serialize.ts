import type { CustodialWalletScope } from "@/generated/prisma/client";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { solscanAccountUrlForNetwork } from "@/lib/custodial-wallet/solscan";
export type SerializedCustodialWalletPublic = {
  publicKey: string;
  chain: "SOLANA";
  network: "devnet" | "mainnet-beta";
  scope: CustodialWalletScope;
  solscanUrl: string;
  balanceSol?: number;
};
/**
 * Shared wallet serializer. Returns only public fields — never private/encrypted keys.
 */
export function serializeCustodialWalletPublic(params: {
  publicKey: string;
  scope: CustodialWalletScope;
  balanceLamports?: bigint | number | null;
}): SerializedCustodialWalletPublic {
  const config = getAgentLaunchConfig();
  const network =
    config.network === "mainnet-beta" || config.network === "devnet"
      ? config.network
      : "devnet";
  const balanceSol =
    params.balanceLamports != null
      ? Number(params.balanceLamports) / 1_000_000_000
      : undefined;
  return {
    publicKey: params.publicKey,
    chain: "SOLANA" as const,
    network,
    scope: params.scope,
    solscanUrl: solscanAccountUrlForNetwork(params.publicKey, network),
    ...(balanceSol === undefined ? {} : { balanceSol }),
  };
}
