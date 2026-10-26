import type { RobinhoodLaunchFormFields } from "@/lib/robinhood-chain/types";
import { ROBINHOOD_LAUNCH_FIELD_LIMITS } from "@/lib/robinhood-chain/launch-form-validation";

const URL_MAX = 2_048;
const SOCIAL_MAX = 512;
const WALLET_MAX = 64;
const CID_MAX = 256;

function stringField(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
  options: { required?: boolean; fallback?: string } = {},
): string | undefined {
  const raw = body[key];
  if (raw == null) {
    if (options.required) throw new Error(`${key} is required.`);
    return options.fallback;
  }
  if (typeof raw !== "string") throw new Error(`${key} must be a string.`);
  const value = raw.trim();
  if (value.length > maxLength) throw new Error(`${key} is too long.`);
  if (options.required && !value) throw new Error(`${key} is required.`);
  return value || options.fallback;
}

function optionalAgentDbId(body: Record<string, unknown>): number | null {
  const raw = body.agentDbId;
  if (raw == null) return null;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new Error("agentDbId must be a positive integer.");
  }
  return raw;
}

export function parseRobinhoodPrepareBody(
  body: Record<string, unknown>,
): RobinhoodLaunchFormFields {
  return {
    tokenName: stringField(body, "tokenName", ROBINHOOD_LAUNCH_FIELD_LIMITS.tokenNameMax, { required: true })!,
    tokenSymbol: stringField(body, "tokenSymbol", ROBINHOOD_LAUNCH_FIELD_LIMITS.tokenSymbolMax, { required: true })!,
    tokenDescription: stringField(body, "tokenDescription", ROBINHOOD_LAUNCH_FIELD_LIMITS.descriptionMax, { fallback: "" })!,
    tokenImageUrl: stringField(body, "tokenImageUrl", URL_MAX, { required: true })!,
    website: stringField(body, "website", URL_MAX, { fallback: "" })!,
    twitter: stringField(body, "twitter", SOCIAL_MAX, { fallback: "" })!,
    telegram: stringField(body, "telegram", SOCIAL_MAX, { fallback: "" })!,
    discord: stringField(body, "discord", SOCIAL_MAX, { fallback: "" })!,
    farcaster: stringField(body, "farcaster", SOCIAL_MAX, { fallback: "" })!,
    creatorWallet: stringField(body, "creatorWallet", WALLET_MAX, { required: true })!,
    agentDbId: optionalAgentDbId(body),
  };
}

export function parseRobinhoodImportMetadata(
  body: Record<string, unknown>,
): Partial<RobinhoodLaunchFormFields> {
  const metadata: Partial<RobinhoodLaunchFormFields> = {};
  const tokenName = stringField(body, "tokenName", ROBINHOOD_LAUNCH_FIELD_LIMITS.tokenNameMax);
  const tokenSymbol = stringField(body, "tokenSymbol", ROBINHOOD_LAUNCH_FIELD_LIMITS.tokenSymbolMax);
  const tokenDescription = stringField(body, "tokenDescription", ROBINHOOD_LAUNCH_FIELD_LIMITS.descriptionMax);
  const tokenImageUrl = stringField(body, "tokenImageUrl", URL_MAX);
  const tokenImageOriginalUrl = stringField(body, "tokenImageOriginalUrl", URL_MAX);
  const tokenLogoIpfsCid = stringField(body, "tokenLogoIpfsCid", CID_MAX);
  const tokenLogoIpfsUri = stringField(body, "tokenLogoIpfsUri", URL_MAX);
  const tokenLogoGatewayUrl = stringField(body, "tokenLogoGatewayUrl", URL_MAX);
  const onChainLogoUrl = stringField(body, "onChainLogoUrl", URL_MAX);
  const website = stringField(body, "website", URL_MAX);
  const twitter = stringField(body, "twitter", SOCIAL_MAX);
  const telegram = stringField(body, "telegram", SOCIAL_MAX);
  const discord = stringField(body, "discord", SOCIAL_MAX);
  const farcaster = stringField(body, "farcaster", SOCIAL_MAX);
  const agentDbId = optionalAgentDbId(body);
  if (tokenName !== undefined) metadata.tokenName = tokenName;
  if (tokenSymbol !== undefined) metadata.tokenSymbol = tokenSymbol;
  if (tokenDescription !== undefined) metadata.tokenDescription = tokenDescription;
  if (tokenImageUrl !== undefined) metadata.tokenImageUrl = tokenImageUrl;
  if (tokenImageOriginalUrl !== undefined) metadata.tokenImageOriginalUrl = tokenImageOriginalUrl;
  if (tokenLogoIpfsCid !== undefined) metadata.tokenLogoIpfsCid = tokenLogoIpfsCid;
  if (tokenLogoIpfsUri !== undefined) metadata.tokenLogoIpfsUri = tokenLogoIpfsUri;
  if (tokenLogoGatewayUrl !== undefined) metadata.tokenLogoGatewayUrl = tokenLogoGatewayUrl;
  if (onChainLogoUrl !== undefined) metadata.onChainLogoUrl = onChainLogoUrl;
  if (website !== undefined) metadata.website = website;
  if (twitter !== undefined) metadata.twitter = twitter;
  if (telegram !== undefined) metadata.telegram = telegram;
  if (discord !== undefined) metadata.discord = discord;
  if (farcaster !== undefined) metadata.farcaster = farcaster;
  if (agentDbId !== null) metadata.agentDbId = agentDbId;
  return metadata;
}
