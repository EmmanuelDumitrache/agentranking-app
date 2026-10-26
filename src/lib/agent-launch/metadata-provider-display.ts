import { extractIpfsPath } from "@/lib/ipfs/uri";

/** Client-safe metadata provider helpers (no env reads). */
export type MetadataProviderKind = "mock" | "ipfs";
export function metadataProviderFromUri(metadataUri: string | null | undefined): MetadataProviderKind | "unknown" {
  if (!metadataUri?.trim()) return "unknown";
  if (metadataUri.startsWith("mock://")) return "mock";
  if (extractIpfsPath(metadataUri)) return "ipfs";
  return "unknown";
}
export function metadataProviderLabel(provider: MetadataProviderKind | "unknown"): string {
  switch (provider) {
    case "mock":
      return "mock (local/dev fallback)";
    case "ipfs":
      return "ipfs";
    default:
      return "unknown";
  }
}
export type LaunchMetadataDisplayInfo = {
  provider: MetadataProviderKind | "unknown";
  metadataUri: string | null;
  passportUri: string | null;
  gatewayMetadataUrl: string | null;
  gatewayPassportUrl: string | null;
};
