import "server-only";
import type { AgentLaunch } from "@/generated/prisma/client";
import {
  gatewayUrlsFromStoredUris,
  type PublishLaunchMetadataResult,
} from "@/lib/agent-launch/metadata-provider";
import {
  metadataProviderFromUri,
  type LaunchMetadataDisplayInfo,
} from "@/lib/agent-launch/metadata-provider-display";
import type { AgentLaunchTokenMetadata } from "@/lib/agent-launch/metadata-token-json";
export function buildLaunchMetadataDisplayInfo(
  launch: Pick<AgentLaunch, "metadataUri" | "passportUri" | "metadataJson">,
  publishResult?: Pick<
    PublishLaunchMetadataResult,
    "gatewayMetadataUrl" | "gatewayPassportUrl" | "provider"
  > | null,
): LaunchMetadataDisplayInfo {
  const provider =
    publishResult?.provider ?? metadataProviderFromUri(launch.metadataUri);
  const fromStored = gatewayUrlsFromStoredUris({
    metadataUri: launch.metadataUri,
    passportUri: launch.passportUri,
  });
  return {
    provider,
    metadataUri: launch.metadataUri,
    passportUri: launch.passportUri,
    gatewayMetadataUrl:
      publishResult?.gatewayMetadataUrl ?? fromStored.gatewayMetadataUrl,
    gatewayPassportUrl:
      publishResult?.gatewayPassportUrl ?? fromStored.gatewayPassportUrl,
  };
}
export function parseStoredTokenMetadataJson(
  metadataJson: unknown,
): AgentLaunchTokenMetadata | null {
  if (!metadataJson || typeof metadataJson !== "object") return null;
  const record = metadataJson as Record<string, unknown>;
  if (typeof record.name !== "string" || typeof record.symbol !== "string") {
    return null;
  }
  return metadataJson as AgentLaunchTokenMetadata;
}