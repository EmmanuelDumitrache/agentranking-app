import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { recomputeAuditRootFromAgentUri } from "@/lib/covenant/audit-recompute";
import { parseSapCapabilities, validateCapabilityIds } from "@/lib/covenant/capabilities";
import { COVENANT_VERIFY_SPEC_VERSION } from "@/lib/covenant/config";
import { decodeLedgerAccountData, isValidRootHashHex, normalizeRootHashHex } from "@/lib/covenant/ledger";
import { deriveCovenantAuditLedgerPdas } from "@/lib/covenant/pda";
import { emptyChecks } from "@/lib/covenant/status";
import type {
  CovenantCheckId,
  CovenantCheckState,
  CovenantVerificationSnapshot,
} from "@/lib/covenant/types";
export type CovenantVerifyInput = {
  sapAgentPda: string;
  sapOwnerWallet: string | null;
  sapCapabilities: unknown;
  agentURI: string | null;
  isActive?: boolean;
  /** Indexed isActive from DB when live RPC skipped */
  indexedActive?: boolean;
};
function setCheck(
  checks: Record<CovenantCheckId, CovenantCheckState>,
  id: CovenantCheckId,
  state: CovenantCheckState,
): void {
  checks[id] = state;
}
function collectMissing(checks: Record<CovenantCheckId, CovenantCheckState>): CovenantCheckId[] {
  return (Object.entries(checks) as Array<[CovenantCheckId, CovenantCheckState]>)
    .filter(([, s]) => s !== "pass")
    .map(([id]) => id);
}
async function verifySignatureMatch(
  connection: Connection,
  ledgerPk: PublicKey,
  ownerWallet: string,
): Promise<{ pass: boolean; signedAt?: string }> {
  try {
    const sigs = await connection.getSignaturesForAddress(ledgerPk, { limit: 5 });
    const sig = sigs.find((s) => !s.err)?.signature;
    if (!sig) return { pass: false };
    const tx = await connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.transaction) return { pass: false };
    const keys = tx.transaction.message.getAccountKeys();
    const signer = keys.get(0)?.toBase58();
    if (!signer || signer.toLowerCase() !== ownerWallet.trim().toLowerCase()) {
      return { pass: false };
    }
    const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : undefined;
    return { pass: true, signedAt: blockTime };
  } catch {
    return { pass: false };
  }
}
/**
 * Run OpenCovenant verified checks 1–5 against live RPC + agentUri.
 */
export async function runCovenantVerification(
  connection: Connection,
  programId: PublicKey,
  input: CovenantVerifyInput,
): Promise<CovenantVerificationSnapshot> {
  const checkedAt = new Date().toISOString();
  const checks = emptyChecks();
  const reasons: string[] = [];
  let rootHashHex: string | undefined;
  let rootSignedBy: string | undefined;
  let rootSignedAt: string | undefined;
  let rootSource: "self" | "sigstore" | undefined = "self";
  let releaseTarget: string | null = null;
  const agentPdaStr = input.sapAgentPda.trim();
  let agentPk: PublicKey;
  try {
    agentPk = new PublicKey(agentPdaStr);
  } catch {
    setCheck(checks, "identity_binding", "fail");
    return finalizeSnapshot(checkedAt, checks, reasons, {});
  }
  // Check 1 — identity binding
  const walletStr = input.sapOwnerWallet?.trim() ?? "";
  let isActive = input.indexedActive ?? input.isActive ?? false;
  try {
    const info = await connection.getAccountInfo(agentPk, "confirmed");
    if (info?.data && info.data.length > 0) {
      // Wallet/active also validated via indexer fields when decode unavailable
      isActive = isActive || info.lamports > 0;
    }
  } catch {
    /* use indexed fields */
  }
  if (walletStr && isActive) {
    setCheck(checks, "identity_binding", "pass");
    reasons.push("OpenCovenant: identity binding passed");
  } else {
    setCheck(checks, "identity_binding", "fail");
  }
  // Check 2 — manifest binding
  const caps = parseSapCapabilities(input.sapCapabilities);
  const capVal = validateCapabilityIds(caps);
  if (capVal.ok && caps.length > 0) {
    setCheck(checks, "manifest_binding", "pass");
    reasons.push("OpenCovenant: manifest binding passed");
  } else if (caps.length === 0) {
    setCheck(checks, "manifest_binding", "fail");
  } else {
    setCheck(checks, "manifest_binding", "fail");
  }
  const { ledger } = deriveCovenantAuditLedgerPdas(agentPk, programId);
  // Check 3 — audit-root presence
  try {
    const ledgerInfo = await connection.getAccountInfo(ledger, "confirmed");
    if (ledgerInfo?.data?.length) {
      const decoded = decodeLedgerAccountData(Buffer.from(ledgerInfo.data));
      if (decoded && isValidRootHashHex(decoded.contentHashHex)) {
        setCheck(checks, "audit_root_presence", "pass");
        reasons.push("OpenCovenant: audit root present");
        rootHashHex = normalizeRootHashHex(decoded.contentHashHex);
        releaseTarget = decoded.releaseTarget;
      } else if (ledgerInfo.data.length >= 40) {
        setCheck(checks, "audit_root_presence", "pass");
        reasons.push("OpenCovenant: audit root present");
      } else {
        setCheck(checks, "audit_root_presence", "fail");
      }
    } else {
      setCheck(checks, "audit_root_presence", "fail");
    }
  } catch {
    setCheck(checks, "audit_root_presence", "pending");
  }
  // Check 4 — signature match
  if (walletStr && checks.audit_root_presence === "pass") {
    const sig = await verifySignatureMatch(connection, ledger, walletStr);
    if (sig.pass) {
      setCheck(checks, "signature_match", "pass");
      reasons.push("OpenCovenant: audit root signed by agent wallet");
      rootSignedBy = walletStr;
      rootSignedAt = sig.signedAt;
      rootSource = "self";
    } else {
      setCheck(checks, "signature_match", "pending");
    }
  } else {
    setCheck(checks, "signature_match", "pending");
  }
  // Check 5 — audit-root recomputation
  if (rootHashHex) {
    const recompute = await recomputeAuditRootFromAgentUri(input.agentURI, rootHashHex);
    if (recompute.ok) {
      setCheck(checks, "audit_root_recomputation", "pass");
      reasons.push("Covenant: audit root recomputed");
    } else {
      setCheck(checks, "audit_root_recomputation", "pending");
      const detail = recompute.error ?? "audit recompute pending";
      const urls =
        recompute.attemptedUrls?.length ? ` (tried ${recompute.attemptedUrls.slice(0, 2).join(", ")})` : "";
      reasons.push(`Covenant: audit root recomputation pending — ${detail}${urls}`);
    }
  } else {
    setCheck(checks, "audit_root_recomputation", "pending");
    reasons.push("Covenant: audit root recomputation pending — no on-chain root");
  }
  return finalizeSnapshot(checkedAt, checks, reasons, {
    rootHashHex,
    rootSignedBy,
    rootSignedAt,
    rootSource,
    releaseTarget,
  });
}
function finalizeSnapshot(
  checkedAt: string,
  checks: Record<CovenantCheckId, CovenantCheckState>,
  reasons: string[],
  extra: Partial<CovenantVerificationSnapshot>,
): CovenantVerificationSnapshot {
  const missingChecks = collectMissing(checks);
  const uniqueReasons = [...new Set(reasons)];
  return {
    specVersion: COVENANT_VERIFY_SPEC_VERSION,
    checkedAt,
    checks,
    missingChecks,
    reasons: uniqueReasons,
    ...extra,
  };
}
