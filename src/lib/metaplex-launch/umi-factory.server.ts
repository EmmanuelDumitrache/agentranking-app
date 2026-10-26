import "server-only";

import { Keypair, PublicKey } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { keypairIdentity } from "@metaplex-foundation/umi";
import { genesis } from "@metaplex-foundation/genesis";
import { mplAgentIdentity } from "@metaplex-foundation/mpl-agent-registry";
import { mplCore } from "@metaplex-foundation/mpl-core";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import type { Umi } from "@metaplex-foundation/umi";
import { getAgentLaunchSolBalanceLamports } from "@/lib/agent-launch/solana";
import { parseAgentLaunchNetwork } from "@/lib/agent-launch/network";
import { resolveMetaplexRpcUrl } from "@/lib/metaplex/rpc-config";

export type MetaplexSvmNetwork = "solana-mainnet" | "solana-devnet";

export function agentLaunchNetworkToMetaplexSvm(network: string): MetaplexSvmNetwork {
  const parsed = parseAgentLaunchNetwork(network);
  return parsed === "mainnet-beta" ? "solana-mainnet" : "solana-devnet";
}

export function resolveIrysNodeUrl(network: MetaplexSvmNetwork): string {
  return network === "solana-devnet"
    ? "https://devnet.irys.xyz"
    : "https://node1.irys.xyz";
}

export function createMetaplexLaunchUmi(network: string): Umi {
  const svmNetwork = agentLaunchNetworkToMetaplexSvm(network);
  const rpc = resolveMetaplexRpcUrl();
  return createUmi(rpc)
    .use(genesis())
    .use(mplCore())
    .use(mplAgentIdentity())
    .use(
      irysUploader({
        address: resolveIrysNodeUrl(svmNetwork),
      }),
    );
}

export function attachCustodialIdentity(umi: Umi, keypair: Keypair): Umi {
  const secret = new Uint8Array(keypair.secretKey);
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(secret);
  return umi.use(keypairIdentity(umiKeypair));
}

export async function getAgentWalletSolBalanceLamports(publicKey: string): Promise<number> {
  return getAgentLaunchSolBalanceLamports(new PublicKey(publicKey.trim()));
}
