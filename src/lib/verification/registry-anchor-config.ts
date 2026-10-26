import "server-only";

import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { credentialProofUrl } from "@/lib/verification/public-agent-credential";

export const VERIFICATION_FEEDBACK_TAG = "agentranking.verification";

function envFlag(name: string, defaultOn = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultOn;
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isRegistryVerificationAnchorEnabled(): boolean {
  return (
    envFlag("VERIFICATION_8004_ANCHOR_ENABLED", false) ||
    envFlag("VERIFICATION_SAP_ANCHOR_ENABLED", false)
  );
}

export function loadRegistryAuthorityKeypair(): Keypair | null {
  const raw =
    process.env.VERIFICATION_REGISTRY_AUTHORITY_SECRET_KEY?.trim() ||
    process.env.VERIFICATION_SAP_ATTESTER_SECRET_KEY?.trim();
  if (!raw) return null;
  try {
    const bytes = bs58.decode(raw);
    if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    if (bytes.length === 32) return Keypair.fromSeed(bytes);
  } catch {
    // fall through
  }
  try {
    const json = JSON.parse(raw) as number[];
    if (Array.isArray(json) && json.length === 64) {
      return Keypair.fromSecretKey(Uint8Array.from(json));
    }
  } catch {
    // fall through
  }
  return null;
}

export function resolveCredentialProofUrl(publicId: string): string {
  return credentialProofUrl(publicId);
}
