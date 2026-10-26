import { COVENANT_RUNTIME_PROTOCOL, COVENANT_VERIFICATION_SNAPSHOT_KEY, COVENANT_VERIFY_SPEC_VERSION } from "@/lib/covenant/config";
import { isCovenantAgent, metadataIndicatesCovenant } from "@/lib/covenant/detect";
import { deriveCovenantStatus, emptyChecks, snapshotToChecks } from "@/lib/covenant/status";
import type {
  CovenantAgentRowInput,
  CovenantDetailPayload,
  CovenantVerificationSnapshot,
} from "@/lib/covenant/types";
export function parseCovenantVerificationSnapshot(
  metadata: Array<{ key: string; value: string }> | undefined,
): CovenantVerificationSnapshot | null {
  if (!metadata?.length) return null;
  const row = metadata.find(
    (m) => m.key.trim().toLowerCase() === COVENANT_VERIFICATION_SNAPSHOT_KEY.toLowerCase(),
  );
  if (!row?.value?.trim()) return null;
  try {
    const parsed = JSON.parse(row.value) as CovenantVerificationSnapshot;
    if (parsed?.specVersion !== COVENANT_VERIFY_SPEC_VERSION) return null;
    if (!parsed.checkedAt || !parsed.checks) return null;
    return parsed;
  } catch {
    return null;
  }
}
export function serializeCovenantVerificationSnapshot(
  snapshot: CovenantVerificationSnapshot,
): string {
  return JSON.stringify({
    ...snapshot,
    specVersion: COVENANT_VERIFY_SPEC_VERSION,
  });
}
export function buildCovenantDetail(
  agent: CovenantAgentRowInput,
  metadata?: Array<{ key: string; value: string }>,
): CovenantDetailPayload {
  const protocols = agent.sapProtocols ?? [];
  const isCovenant =
    isCovenantAgent(protocols, agent.sapCapabilities) ||
    metadataIndicatesCovenant(metadata ?? agent.metadata);
  const snapshot = parseCovenantVerificationSnapshot(metadata);
  if (!isCovenant) {
    return {
      isCovenant: false,
      status: "not_covenant",
      reasons: [],
      missingChecks: [],
      checks: emptyChecks(),
    };
  }
  const checks = snapshotToChecks(snapshot);
  const status = deriveCovenantStatus(true, checks, snapshot?.rootSource);
  return {
    isCovenant: true,
    status,
    protocolVersion: protocols.find((p) => p === COVENANT_RUNTIME_PROTOCOL) ?? COVENANT_RUNTIME_PROTOCOL,
    rootHashHex: snapshot?.rootHashHex,
    rootSignedBy: snapshot?.rootSignedBy,
    rootSignedAt: snapshot?.rootSignedAt,
    rootCheckedAt: snapshot?.checkedAt,
    rootSource: snapshot?.rootSource,
    releaseTarget: snapshot?.releaseTarget ?? null,
    reasons: snapshot?.reasons ?? [],
    missingChecks: (snapshot?.missingChecks ?? []).map(String),
    checks,
  };
}