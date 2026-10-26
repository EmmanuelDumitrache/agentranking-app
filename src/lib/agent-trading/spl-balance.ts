import "server-only";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { getAgentLaunchConnection } from "@/lib/agent-launch/solana";

export async function loadSplTokenBalanceRaw(
  mintAddress: string,
  ownerAddress: string,
): Promise<bigint | null> {
  try {
    const connection = getAgentLaunchConnection();
    const mint = new PublicKey(mintAddress);
    const owner = new PublicKey(ownerAddress);
    const mintInfo = await connection.getAccountInfo(mint, "confirmed");
    if (!mintInfo) return null;
    const programId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const ata = getAssociatedTokenAddressSync(mint, owner, true, programId);
    try {
      const balance = await connection.getTokenAccountBalance(ata, "confirmed");
      return BigInt(balance.value.amount);
    } catch {
      return BigInt(0);
    }
  } catch {
    return null;
  }
}
