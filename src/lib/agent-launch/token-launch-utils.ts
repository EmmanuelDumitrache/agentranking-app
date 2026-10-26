import {
  validateTokenDescription,
  validateTokenName,
  validateTokenSymbol,
} from "@/lib/agent-launch/validation";
import type { LaunchProfileEnrichmentFields } from "@/lib/agent-launch/launch-profile-enrichment";

export type TokenLaunchFormFields = {
  tokenName: string;
  tokenSymbol: string;
  tokenDescription: string;
  tokenImageUrl: string;
  website: string;
  twitter: string;
  telegram: string;
};

export type TokenLaunchFormFieldsNoWebsite = Omit<TokenLaunchFormFields, "website">;

export type TokenLaunchWithProfileFields = TokenLaunchFormFieldsNoWebsite &
  LaunchProfileEnrichmentFields;
export function validateTokenLaunchForm(
  fields: TokenLaunchFormFieldsNoWebsite | TokenLaunchFormFields,
): string | null {
  const nameError = validateTokenName(fields.tokenName);
  if (nameError) return nameError;
  const symbolError = validateTokenSymbol(fields.tokenSymbol);
  if (symbolError) return symbolError;
  const descriptionError = validateTokenDescription(fields.tokenDescription);
  if (descriptionError) return descriptionError;
  return null;
}
export function mapTokenLaunchError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Launch failed";
  const lower = message.toLowerCase();
  if (lower.includes("already in use") || lower.includes("mint_already_on_chain")) {
    return "This token was already created on Pump.fun. Finishing setup — do not launch again.";
  }
  if (lower.includes("not found on mainnet") || lower.includes("not found on devnet")) {
    return "Transaction is still indexing. Your token may already be created — wait a moment and try again.";
  }
  if (lower.includes("recover") && lower.includes("pump.fun")) {
    return message;
  }
  if (lower.includes("unauthorized") || lower.includes("not authorized")) {
    return "You are not authorized to launch for this agent.";
  }
  if (lower.includes("wallet") && lower.includes("connect")) {
    return "Agent wallet signing is not ready yet. Server-side launch signing ships in the next update.";
  }
  if (lower.includes("creator wallet")) {
    return "Agent wallet is not ready for this launch.";
  }
  if (
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit") ||
    lower.includes("connection rate limits")
  ) {
    return "Solana RPC is rate-limited right now. Wait about 30 seconds and launch again — do not spam retry.";
  }
  if (lower.includes("insufficient") || lower.includes("lamports")) {
    return lower.includes("mainnet")
      ? "Insufficient SOL in the agent wallet for launch fees. Add SOL and try again."
      : "Insufficient funding. Add devnet SOL to your wallet and try again.";
  }
  if (lower.includes("token name") || lower.includes("token symbol")) {
    return "Token details are invalid. Check name and symbol.";
  }
  if (lower.includes("user rejected") || lower.includes("cancelled")) {
    return "Transaction was cancelled in your wallet.";
  }
  if (
    lower.includes("block height exceeded") ||
    lower.includes("blockhash not found") ||
    lower.includes("signature") && lower.includes("expired")
  ) {
    return "Phantom took too long to approve — your transfer may still have gone through. Wait a few seconds and tap Fund & continue again.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Network unavailable. Check your connection and try again.";
  }
  if (lower.includes("launch backend") || lower.includes("not enabled")) {
    return "Launch backend unavailable in this environment.";
  }
  return message.length > 160 ? "Launch failed. Please try again." : message;
}