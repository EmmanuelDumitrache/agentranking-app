import { createHash, randomBytes } from "node:crypto";
import { verifyMessage } from "viem";
import { verifySolanaSignMessage } from "@/lib/sap-claim-verify";
import type { RiskTier } from "./providers/types";

export type VerificationChain = "solana" | "evm";

export function normalizeVerificationChain(chain: string): VerificationChain | null {
  const c = chain.trim().toLowerCase();
  if (c === "solana" || c === "sol") return "solana";
  if (c === "evm" || c === "ethereum" || c === "eth") return "evm";
  return null;
}

export function generateNonce(): string {
  return randomBytes(24).toString("hex");
}

export function buildOwnershipMessage(params: {
  agentId: number;
  walletAddress: string;
  nonce: string;
  expiresIso: string;
}): string {
  return [
    "AgentRanking Ownership Proof",
    `Agent: ${params.agentId}`,
    `Wallet: ${params.walletAddress}`,
    `Nonce: ${params.nonce}`,
    `Expires: ${params.expiresIso}`,
  ].join("\n");
}

export function buildDelegationMessage(params: {
  ownerWallet: string;
  delegatedWallet: string;
  delegatedAgentId: number;
  scopes: string[];
  nonce: string;
}): string {
  return [
    "AgentRanking Delegation",
    `Parent: ${params.ownerWallet}`,
    `Delegate: ${params.delegatedWallet}`,
    `Agent: ${params.delegatedAgentId}`,
    `Scopes: ${params.scopes.join(",")}`,
    `Nonce: ${params.nonce}`,
  ].join("\n");
}

export function buildRevokeDelegationMessage(params: {
  ownerWallet: string;
  delegationId: string;
  nonce: string;
}): string {
  return [
    "AgentRanking Revoke Delegation",
    `Parent: ${params.ownerWallet}`,
    `Delegation: ${params.delegationId}`,
    `Nonce: ${params.nonce}`,
  ].join("\n");
}

export async function verifyWalletSignature(params: {
  chain: VerificationChain;
  walletAddress: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  if (params.chain === "solana") {
    return verifySolanaSignMessage(params.message, params.signature, params.walletAddress);
  }
  try {
    return await verifyMessage({
      address: params.walletAddress as `0x${string}`,
      message: params.message,
      signature: params.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

export function walletsMatch(a: string, b: string, chain: VerificationChain): boolean {
  if (chain === "evm") return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a.trim() === b.trim();
}

export function computePassportHash(canonical: {
  agentId: number;
  ownerWallet: string;
  ownerWalletChain: string;
  riskTier: RiskTier;
  riskScore: number;
  issuedAt: string | null;
}): string {
  const payload = JSON.stringify({
    v: 1,
    agentId: canonical.agentId,
    ownerWallet: canonical.ownerWallet,
    ownerWalletChain: canonical.ownerWalletChain,
    riskTier: canonical.riskTier,
    riskScore: canonical.riskScore,
    issuedAt: canonical.issuedAt,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Phase 3 stub — on-chain anchoring of passportHash.
 * Do not build the Anchor program in Phase 1.
 */
export async function anchorPassport(_params: {
  passportId: string;
  passportHash: string;
}): Promise<{ txSignature: string } | null> {
  // TODO(Phase 3): Submit passportHash to on-chain attestation program
  // TODO(Phase 3): Persist returned signature to AgentPassport.anchorTx
  // TODO(Phase 3): Choose target chain / program via ANCHOR_* env (never hardcode partner)
  return null;
}

export function passportValidityDays(): number {
  const raw = process.env.PASSPORT_VALIDITY_DAYS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 365;
  return Number.isFinite(n) && n > 0 ? n : 365;
}

export function challengeTtlMs(): number {
  return 10 * 60 * 1000;
}
