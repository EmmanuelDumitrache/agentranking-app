import { hash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { COVENANT_AUDIT_ROOT_LABEL } from "@/lib/covenant/config";
export function sha256Utf8Label(label: string): Buffer {
  return hash("sha256", label, "buffer");
}
export function deriveCovenantAuditLedgerPdas(
  agentPda: PublicKey,
  programId: PublicKey,
  label: string = COVENANT_AUDIT_ROOT_LABEL,
): { vault: PublicKey; session: PublicKey; ledger: PublicKey } {
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("sap_vault"), agentPda.toBuffer()],
    programId,
  );
  const sessionHash = sha256Utf8Label(label);
  const [session] = PublicKey.findProgramAddressSync(
    [Buffer.from("sap_session"), vault.toBuffer(), sessionHash],
    programId,
  );
  const [ledger] = PublicKey.findProgramAddressSync(
    [Buffer.from("sap_ledger"), session.toBuffer()],
    programId,
  );
  return { vault, session, ledger };
}
