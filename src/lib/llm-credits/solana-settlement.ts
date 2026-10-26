import { createMerchantClient, FindReferenceError } from "@solana/pay";
import { address } from "@solana/kit";
export async function findReferenceForDeposit(
  rpcUrl: string,
  referencePubkey: string,
  commitment: "confirmed" | "finalized" = "confirmed",
): Promise<string | null> {
  try {
    const merchant = createMerchantClient({ rpcUrl });
    const ref = address(referencePubkey);
    const result = await merchant.pay.findReference(ref, { commitment });
    return result.signature;
  } catch (err) {
    if (err instanceof FindReferenceError) return null;
    throw err;
  }
}
