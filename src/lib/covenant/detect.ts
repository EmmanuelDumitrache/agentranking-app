import type { Prisma } from "@/generated/prisma/client";
import {
  COVENANT_DETECTED_AT_KEY,
  COVENANT_RUNTIME_PROTOCOL,
} from "@/lib/covenant/config";
import type { CovenantDetailPayload } from "@/lib/covenant/types";
function normalizeProtocolToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
/** True when SAP capability rows declare Covenant (protocol id or namespace:method id). */
export function capabilitiesIndicateCovenant(capabilities: unknown): boolean {
  if (!Array.isArray(capabilities)) return false;
  return capabilities.some((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const cap = raw as Record<string, unknown>;
    const protocol = normalizeProtocolToken(cap.protocolId ?? cap.protocol).toLowerCase();
    const id = normalizeProtocolToken(cap.id).toLowerCase();
    if (protocol === COVENANT_RUNTIME_PROTOCOL) return true;
    if (protocol.startsWith("covenant.")) return true;
    if (protocol === "covenant") return true;
    if (id.startsWith("covenant:")) return true;
    return false;
  });
}
/** Ensure covenant.runtime/v1 is present when capabilities imply Covenant. */
export function mergeCovenantProtocols(
  protocols: string[] | null | undefined,
  capabilities?: unknown,
): string[] {
  const merged = new Set(
    (protocols ?? []).map((p) => p.trim()).filter((p) => p.length > 0),
  );
  if (capabilitiesIndicateCovenant(capabilities)) {
    merged.add(COVENANT_RUNTIME_PROTOCOL);
  }
  return [...merged];
}
export function isCovenantAgent(
  protocols: string[] | null | undefined,
  capabilities?: unknown,
): boolean {
  if ((protocols ?? []).some((p) => p.trim() === COVENANT_RUNTIME_PROTOCOL)) {
    return true;
  }
  return capabilitiesIndicateCovenant(capabilities);
}
export function metadataIndicatesCovenant(
  metadata: Array<{ key: string; value: string }> | null | undefined,
): boolean {
  if (!metadata?.length) return false;
  return metadata.some(
    (m) => m.key.trim().toLowerCase() === COVENANT_DETECTED_AT_KEY.toLowerCase(),
  );
}
/** Prisma filter for /covenant hub and ?covenant=true listings. */
export function covenantAgentListingWhere(): Prisma.AgentWhereInput {
  return {
    isActive: true,
    OR: [
      { sapProtocols: { has: COVENANT_RUNTIME_PROTOCOL } },
      { metadata: { some: { key: COVENANT_DETECTED_AT_KEY } } },
    ],
  };
}
/** Gate Covenant partner UI (header, sidebar, runtime card). */
export function showCovenantUi(input: {
  sapProtocols?: string[] | null;
  sapCapabilities?: unknown;
  covenant?: CovenantDetailPayload | null;
  metadata?: Array<{ key: string; value: string }>;
}): boolean {
  if (input.covenant?.isCovenant === true) return true;
  if (isCovenantAgent(input.sapProtocols, input.sapCapabilities)) return true;
  return metadataIndicatesCovenant(input.metadata);
}