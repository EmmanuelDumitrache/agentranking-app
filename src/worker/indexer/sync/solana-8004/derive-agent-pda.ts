import { PublicKey } from "@solana/web3.js";
import { SOLANA_8004_AGENT_SEED } from "./constants.js";

export function deriveSolana8004AgentPdaWithBump(
  assetAddress: string,
  programId: string,
): { address: string; bump: number } {
  const asset = new PublicKey(assetAddress);
  const program = new PublicKey(programId);
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [SOLANA_8004_AGENT_SEED, asset.toBuffer()],
    program,
  );
  return { address: pda.toBase58(), bump };
}

export function deriveSolana8004AgentPda(assetAddress: string, programId: string): string {
  return deriveSolana8004AgentPdaWithBump(assetAddress, programId).address;
}
