import "server-only";
import type { AgentLaunch } from "@/generated/prisma/client";
import type { AgentPassport } from "@/lib/agent-launch/passport";
import { mockMetadataUri, mockPassportUri } from "@/lib/agent-launch/passport";
import type { MetadataProviderKind } from "@/lib/agent-launch/metadata-provider-display";
import {
  buildAgentLaunchTokenMetadata,
  enrichTokenMetadataWithPassport,
  type AgentLaunchTokenMetadata,
} from "@/lib/agent-launch/metadata-token-json";
import { addJsonToKubo, getKuboConfig } from "@/lib/ipfs/kubo";
import { buildIpfsGatewayUrl } from "@/lib/ipfs/uri";
import { resolveTokenImageForMetadata } from "@/lib/agent-launch/prepare-token-image-for-metadata.server";
export type { MetadataProviderKind, AgentLaunchTokenMetadata };
export type MetadataProviderResult = {
  metadataUri: string;
  passportUri: string;
  gatewayMetadataUrl?: string;
  gatewayPassportUrl?: string;
  provider: MetadataProviderKind;
};
export type MetadataProviderInput = {
  launch: Pick<
    AgentLaunch,
    | "id"
    | "mint"
    | "tokenName"
    | "tokenSymbol"
    | "tokenDescription"
    | "tokenImageUrl"
    | "network"
    | "profileGithub"
    | "profileTwitter"
    | "profileTelegram"
    | "profileTags"
  >;
  passportJson: AgentPassport;
  imagePlaceholder?: string | null;
  creatorShareBps?: number;
  arShareBps?: number;
  proposedMint?: string | null;
  twitter?: string | null;
  telegram?: string | null;
};
export type MetadataProviderConfig = {
  provider: MetadataProviderKind;
  ipfsGateway: string | null;
  ipfsApiUrl: string | null;
  ipfsConfigured: boolean;
};
function envProviderKind(): MetadataProviderKind {
  const raw = process.env.AGENT_LAUNCH_METADATA_PROVIDER?.trim().toLowerCase();
  if (raw === "ipfs" || raw === "kubo") return "ipfs";
  return "mock";
}
export function getMetadataProviderConfig(): MetadataProviderConfig {
  const provider = envProviderKind();
  const kubo = getKuboConfig();
  return {
    provider,
    ipfsGateway: kubo.publicGatewayUrl,
    ipfsApiUrl: kubo.apiUrl,
    ipfsConfigured:
      provider === "ipfs" &&
      Boolean(kubo.apiUrl && kubo.publicGatewayUrl && kubo.bearerTokenConfigured),
  };
}
async function uploadJsonDocument(
  label: string,
  json: unknown,
): Promise<{ uri: string; gatewayUrl?: string }> {
  const uploaded = await addJsonToKubo(label, json);
  return { uri: uploaded.uri, gatewayUrl: uploaded.gatewayUrl };
}
async function publishMockProvider(input: MetadataProviderInput): Promise<MetadataProviderResult> {
  return {
    metadataUri: mockMetadataUri(input.launch.id),
    passportUri: mockPassportUri(input.launch.id),
    provider: "mock",
  };
}
async function publishIpfsProvider(
  input: MetadataProviderInput,
  tokenMetadataJson: AgentLaunchTokenMetadata,
  passportJson: AgentPassport,
): Promise<MetadataProviderResult> {
  const passportUpload = await uploadJsonDocument(`${input.launch.id}-passport.json`, passportJson);
  const metadataUpload = await uploadJsonDocument(`${input.launch.id}-metadata.json`, {
    ...tokenMetadataJson,
    ar_passport_uri: passportUpload.uri,
  });
  return {
    metadataUri: metadataUpload.uri,
    passportUri: passportUpload.uri,
    gatewayMetadataUrl: metadataUpload.gatewayUrl,
    gatewayPassportUrl: passportUpload.gatewayUrl,
    provider: "ipfs",
  };
}
export type PublishLaunchMetadataResult = MetadataProviderResult & {
  tokenMetadataJson: AgentLaunchTokenMetadata;
  passportJson: AgentPassport;
};
export async function publishLaunchMetadata(
  input: MetadataProviderInput,
): Promise<PublishLaunchMetadataResult> {
  const config = getMetadataProviderConfig();
  const isMainnet = input.launch.network === "mainnet-beta";
  if (isMainnet && config.provider === "mock") {
    throw new Error(
      "Mainnet tokens require IPFS metadata. Set AGENT_LAUNCH_METADATA_PROVIDER=ipfs and configure the remote Kubo RPC plus the self-hosted public gateway.",
    );
  }
  if (config.provider === "ipfs" && !config.ipfsConfigured) {
    throw new Error(
      "IPFS metadata is enabled but remote Kubo is incomplete. Configure IPFS_API_URL, IPFS_API_BEARER_TOKEN, and IPFS_GATEWAY_URL.",
    );
  }
  const passportUriPreview =
    config.provider === "mock" ? mockPassportUri(input.launch.id) : "ipfs://pending-passport";
  const effectiveMint = input.proposedMint?.trim() || input.launch.mint?.trim() || null;
  const resolvedTokenImageUrl =
    config.provider === "ipfs" && input.launch.tokenImageUrl?.trim()
      ? await resolveTokenImageForMetadata({
          tokenImageUrl: input.launch.tokenImageUrl,
          launchId: input.launch.id,
        })
      : input.launch.tokenImageUrl;
  const baseMetadata = buildAgentLaunchTokenMetadata({
    mint: effectiveMint,
    tokenName: input.launch.tokenName,
    tokenSymbol: input.launch.tokenSymbol,
    tokenDescription: input.launch.tokenDescription,
    tokenImageUrl: resolvedTokenImageUrl,
    network: input.launch.network,
    passportUri: passportUriPreview,
    imagePlaceholder: input.imagePlaceholder,
    creatorShareBps: input.creatorShareBps,
    arShareBps: input.arShareBps,
    twitter: input.twitter ?? input.launch.profileTwitter,
    telegram: input.telegram ?? input.launch.profileTelegram,
    github: input.launch.profileGithub,
    capabilityTags: input.launch.profileTags ?? [],
  });
  const tokenMetadataJson = enrichTokenMetadataWithPassport(baseMetadata, input.passportJson);
  const result =
    config.provider === "ipfs"
      ? await publishIpfsProvider(input, tokenMetadataJson, input.passportJson)
      : await publishMockProvider(input);
  const finalTokenMetadataJson = enrichTokenMetadataWithPassport(
    buildAgentLaunchTokenMetadata({
      mint: effectiveMint,
      tokenName: input.launch.tokenName,
      tokenSymbol: input.launch.tokenSymbol,
      tokenDescription: input.launch.tokenDescription,
      tokenImageUrl: resolvedTokenImageUrl,
      network: input.launch.network,
      passportUri: result.passportUri,
      imagePlaceholder: input.imagePlaceholder,
      creatorShareBps: input.creatorShareBps,
      arShareBps: input.arShareBps,
      twitter: input.twitter ?? input.launch.profileTwitter,
      telegram: input.telegram ?? input.launch.profileTelegram,
      github: input.launch.profileGithub,
      capabilityTags: input.launch.profileTags ?? [],
    }),
    input.passportJson,
  );
  return { ...result, tokenMetadataJson: finalTokenMetadataJson, passportJson: input.passportJson };
}
export function gatewayUrlsFromStoredUris(input: {
  metadataUri: string | null;
  passportUri: string | null;
}): { gatewayMetadataUrl: string | null; gatewayPassportUrl: string | null } {
  const gateway = getMetadataProviderConfig().ipfsGateway;
  return {
    gatewayMetadataUrl: buildIpfsGatewayUrl(gateway, input.metadataUri),
    gatewayPassportUrl: buildIpfsGatewayUrl(gateway, input.passportUri),
  };
}
