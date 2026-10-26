import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
export function tokenProgramLabel(programId: PublicKey): string {
  if (programId.equals(TOKEN_PROGRAM_ID)) return "SPL Token";
  if (programId.equals(TOKEN_2022_PROGRAM_ID)) return "Token-2022";
  return programId.toBase58();
}
/** Resolve whether a mint is original SPL Token or Token-2022 (Pump.fun tokens are usually Token-2022). */
export async function resolveTokenProgramIdForMint(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) {
    throw new Error(`Mint account not found on-chain: ${mint.toBase58()}`);
  }
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error(
    `Mint ${mint.toBase58()} is owned by ${info.owner.toBase58()}, not SPL Token or Token-2022.`,
  );
}
