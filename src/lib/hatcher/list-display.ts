import { parseHatcherMetadata } from "@/lib/hatcher/snapshot";
import type { HatcherMetadata } from "@/lib/hatcher/types";
export type HatcherListDisplayFields = {
  meta: HatcherMetadata | null;
  framework: string;
  status: string;
  statusNormalized: "active" | "sleeping" | "other";
  messageCount: number;
  hasPassport: boolean;
  hasMcp: boolean;
  discoveryScore: number;
  publicChatEnabled: boolean;
  ownerUsername: string;
};
function normalizeStatus(status: string | undefined): HatcherListDisplayFields["statusNormalized"] {
  const s = (status ?? "").toLowerCase();
  if (s === "active" || s === "running") return "active";
  if (s === "sleeping" || s === "dormant") return "sleeping";
  return "other";
}
export function getHatcherListDisplayFields(input: {
  metadata?: Array<{ key: string; value: string }>;
  score?: number;
  partnerScore?: number;
}): HatcherListDisplayFields {
  const meta = parseHatcherMetadata(input.metadata);
  const passportSnap = meta?.passportSnapshot;
  const mcpSnap = meta?.mcpManifestSnapshot;
  return {
    meta,
    framework: meta?.framework?.trim() || "—",
    status: meta?.status?.trim() || "—",
    statusNormalized: normalizeStatus(meta?.status),
    messageCount: meta?.messageCount ?? 0,
    hasPassport: passportSnap != null && typeof passportSnap === "object",
    hasMcp: mcpSnap != null && typeof mcpSnap === "object",
    discoveryScore: meta?.partnerScore ?? input.partnerScore ?? input.score ?? 0,
    publicChatEnabled: meta?.publicChatEnabled === true,
    ownerUsername: meta?.owner?.username?.trim() || "—",
  };
}
