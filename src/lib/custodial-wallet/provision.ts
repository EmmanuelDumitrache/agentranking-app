import { Keypair } from "@solana/web3.js";
import type { CustodialWalletScope, Prisma } from "@/generated/prisma/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hexToBytes } from "viem";
import { encryptSecretBytes } from "@/lib/custodial-wallet/crypto";
import { logCustodialWalletAudit } from "@/lib/custodial-wallet/audit";
export type ProvisionedCustodialWallet = {
  id: string;
  publicKey: string;
  scope: CustodialWalletScope;
};
export async function provisionCustodialSolanaWallet(
  tx: Prisma.TransactionClient,
  params: {
    scope: CustodialWalletScope;
    actorProfileId?: number;
  },
): Promise<ProvisionedCustodialWallet> {
  const keypair = Keypair.generate();
  const { encryptedSecret, encryptionKeyId, encryptionVersion } = encryptSecretBytes(keypair.secretKey);
  const wallet = await tx.custodialWallet.create({
    data: {
      scope: params.scope,
      chain: "solana",
      publicKey: keypair.publicKey.toBase58(),
      encryptedSecret,
      encryptionKeyId,
      encryptionVersion,
    },
    select: { id: true, publicKey: true, scope: true },
  });
  await logCustodialWalletAudit(wallet.id, `wallet.provisioned.${params.scope.toLowerCase()}`, {
    actorProfileId: params.actorProfileId,
    metadata: { publicKey: wallet.publicKey },
    tx,
  });
  return wallet;
}
/** Server-generated EVM key for Robinhood launches/claims (no Privy). */
export async function provisionCustodialEvmWallet(
  tx: Prisma.TransactionClient,
  params: {
    scope: CustodialWalletScope;
    actorProfileId?: number;
  },
): Promise<ProvisionedCustodialWallet> {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const address = account.address.toLowerCase();
  const { encryptedSecret, encryptionKeyId, encryptionVersion } = encryptSecretBytes(
    hexToBytes(privateKey),
  );
  const wallet = await tx.custodialWallet.create({
    data: {
      scope: params.scope,
      chain: "evm",
      publicKey: address,
      encryptedSecret,
      encryptionKeyId,
      encryptionVersion,
    },
    select: { id: true, publicKey: true, scope: true },
  });
  await logCustodialWalletAudit(wallet.id, `wallet.provisioned.evm.${params.scope.toLowerCase()}`, {
    actorProfileId: params.actorProfileId,
    metadata: { publicKey: wallet.publicKey, chain: "evm" },
    tx,
  });
  return wallet;
}