import { Keypair, PublicKey } from "@solana/web3.js";
export function generateDepositReference(): {
  publicKey: string;
  secretKey: Uint8Array;
} {
  const kp = Keypair.generate();
  return {
    publicKey: kp.publicKey.toBase58(),
    secretKey: kp.secretKey,
  };
}
export function referencePublicKeyFromString(s: string): PublicKey {
  return new PublicKey(s);
}