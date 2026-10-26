import { isAddress } from "viem";
import type { RobinhoodLaunchFormFields } from "@/lib/robinhood-chain/types";
const TOKEN_NAME_MAX = 60;
const TOKEN_SYMBOL_MAX = 20;
const DESCRIPTION_MAX = 256;
function normalizeOptional(value: string | undefined): string {
  return (value ?? "").trim();
}
export function validateRobinhoodLaunchForm(
  fields: Partial<RobinhoodLaunchFormFields>,
): string | null {
  const name = normalizeOptional(fields.tokenName);
  const symbol = normalizeOptional(fields.tokenSymbol);
  const image = normalizeOptional(fields.tokenImageUrl);
  const wallet = normalizeOptional(fields.creatorWallet);
  if (!wallet || !isAddress(wallet)) return "Connect a valid wallet on Robinhood Chain.";
  if (!name) return "Token name is required.";
  if (name.length > TOKEN_NAME_MAX) return `Token name must be at most ${TOKEN_NAME_MAX} characters.`;
  if (!symbol) return "Token symbol is required.";
  if (symbol.length > TOKEN_SYMBOL_MAX) return `Token symbol must be at most ${TOKEN_SYMBOL_MAX} characters.`;
  if (!image) return "Token logo is required.";
  const desc = normalizeOptional(fields.tokenDescription);
  if (desc.length > DESCRIPTION_MAX) return `Description must be at most ${DESCRIPTION_MAX} characters.`;
  return null;
}
export function normalizeRobinhoodOptional(value: string | undefined): string {
  return normalizeOptional(value);
}
export const ROBINHOOD_LAUNCH_FIELD_LIMITS = {
  tokenNameMax: TOKEN_NAME_MAX,
  tokenSymbolMax: TOKEN_SYMBOL_MAX,
  descriptionMax: DESCRIPTION_MAX,
} as const;