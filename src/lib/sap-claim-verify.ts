import nacl from "tweetnacl";
import bs58 from "bs58";
export { buildSapClaimMessage, isFreshClaimTimestamp, parseSapClaimMessage, normalizeSolanaAddress } from "@/lib/sap-claim-message";
/** `signature` and `publicKey` are base58-encoded (Phantom / Solana wallet `signMessage`). */
export function verifySolanaSignMessage(messageUtf8: string, signatureB58: string, publicKeyB58: string): boolean {
  try {
    const msgBytes = new TextEncoder().encode(messageUtf8);
    const sig = bs58.decode(signatureB58);
    const pub = bs58.decode(publicKeyB58);
    if (pub.length !== nacl.sign.publicKeyLength) return false;
    if (sig.length !== nacl.sign.signatureLength) return false;
    return nacl.sign.detached.verify(msgBytes, sig, pub);
  } catch {
    return false;
  }
}
