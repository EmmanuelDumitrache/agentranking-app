import { PublicKey } from "@solana/web3.js";
import {
  AR_AGENT_IDENTITY_PDA_SEED,
  AR_AGENT_IDENTITY_PROGRAM_ID,
} from "@/lib/agent-identity-registry/constants";

export function findArAgentIdentityPda(tokenMint: PublicKey | string): {
  pda: PublicKey;
  bump: number;
} {
  const mint = typeof tokenMint === "string" ? new PublicKey(tokenMint) : tokenMint;
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(AR_AGENT_IDENTITY_PDA_SEED), mint.toBuffer()],
    new PublicKey(AR_AGENT_IDENTITY_PROGRAM_ID),
  );
  return { pda, bump };
}
