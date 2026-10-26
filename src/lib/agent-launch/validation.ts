import { PublicKey } from "@solana/web3.js";
import { trySolanaPublicKey } from "@/lib/ar-token-ledger";
import { TOKEN_DESCRIPTION_MAX_LENGTH, TOKEN_NAME_MAX_LENGTH, TOKEN_SYMBOL_MAX_LENGTH } from "@/lib/agent-launch/constants";
import { LOCAL_TEST_AGENT_ID } from "@/lib/agent-launch/constants-local";
import { findDemoLaunchTemplateByAgentId } from "@/lib/agent-launch/demo-templates";
export function validateSolanaPubkey(
  value: string | undefined,
  label: string,
): string | null {
  if (!value?.trim()) return `${label} is required`;
  if (!trySolanaPublicKey(value.trim())) {
    return `${label} must be a valid Solana public key`;
  }
  return null;
}
export function parseSolanaPubkey(value: string, label: string): PublicKey {
  const pk = trySolanaPublicKey(value.trim());
  if (!pk) throw new Error(`${label} must be a valid Solana public key`);
  return pk;
}
export type DraftPatchInput = {
  agentId?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDescription?: string;
  tokenImageUrl?: string;
  creatorWallet?: string;
  passportJson?: unknown;
  profileWebsite?: string;
  profileTwitter?: string;
  profileTelegram?: string;
  profileGithub?: string;
  profileTags?: string[];
  archetype?: string;
  profileServices?: Array<{ name?: string; endpoint?: string; version?: string }>;
};
export function validateAgentId(agentId: string | undefined): string | null {
  if (agentId === undefined) return null;
  const trimmed = agentId.trim();
  if (!trimmed) return "Agent id is required";
  if (trimmed === LOCAL_TEST_AGENT_ID) return null;
  if (trimmed.startsWith("demo:")) {
    if (!findDemoLaunchTemplateByAgentId(trimmed)) {
      return `Unknown demo agent id: ${trimmed}`;
    }
    return null;
  }
  const numericId = Number.parseInt(trimmed, 10);
  if (Number.isFinite(numericId) && String(numericId) === trimmed) {
    return null;
  }
  return "Agent id must be a dashboard agent number, local-test-agent, or demo:* preset id";
}
export function validateTokenName(name: string | undefined): string | null {
  if (name === undefined) return null;
  const trimmed = name.trim();
  if (!trimmed) return "Token name is required";
  if (trimmed.length > TOKEN_NAME_MAX_LENGTH) {
    return `Token name must be at most ${TOKEN_NAME_MAX_LENGTH} characters`;
  }
  return null;
}
export function validateTokenSymbol(symbol: string | undefined): string | null {
  if (symbol === undefined) return null;
  const trimmed = symbol.trim().toUpperCase();
  if (!trimmed) return "Token symbol is required";
  if (trimmed.length > TOKEN_SYMBOL_MAX_LENGTH) {
    return `Token symbol must be at most ${TOKEN_SYMBOL_MAX_LENGTH} characters`;
  }
  if (!/^[A-Z0-9]+$/.test(trimmed)) {
    return "Token symbol must be alphanumeric";
  }
  return null;
}
export function validateTokenDescription(description: string | undefined): string | null {
  if (description === undefined) return null;
  const trimmed = description.trim();
  if (!trimmed) return "Token description is required";
  if (trimmed.length > TOKEN_DESCRIPTION_MAX_LENGTH) {
    return `Token description must be at most ${TOKEN_DESCRIPTION_MAX_LENGTH} characters`;
  }
  return null;
}
export function validateCreatorWallet(wallet: string | undefined): string | null {
  if (wallet === undefined) return null;
  return validateSolanaPubkey(wallet, "Creator wallet");
}
export function validateMintPubkey(mint: string | undefined): string | null {
  if (mint === undefined) return null;
  return validateSolanaPubkey(mint, "Mint");
}
export function validateDraftPatch(input: DraftPatchInput): string[] {
  const errors: string[] = [];
  const nameError = validateTokenName(input.tokenName);
  if (nameError) errors.push(nameError);
  const symbolError = validateTokenSymbol(input.tokenSymbol);
  if (symbolError) errors.push(symbolError);
  const descriptionError = validateTokenDescription(input.tokenDescription);
  if (descriptionError) errors.push(descriptionError);
  const walletError = validateCreatorWallet(input.creatorWallet);
  if (walletError) errors.push(walletError);
  const agentIdError = validateAgentId(input.agentId);
  if (agentIdError) errors.push(agentIdError);
  return errors;
}
