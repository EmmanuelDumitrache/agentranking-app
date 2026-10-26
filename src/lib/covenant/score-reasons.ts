import type { CovenantCheckId, CovenantVerificationSnapshot } from "@/lib/covenant/types";
import { isCovenantAgent } from "@/lib/covenant/detect";
const CHECK_REASON: Record<CovenantCheckId, string> = {
  identity_binding: "OpenCovenant: identity binding passed",
  manifest_binding: "OpenCovenant: manifest binding passed",
  audit_root_presence: "OpenCovenant: audit root present",
  signature_match: "OpenCovenant: audit root signed by agent wallet",
  audit_root_recomputation: "OpenCovenant: audit root recomputed",
};
/** Max protocol-trust points from OpenCovenant checks (indexed alone stays small). */
export const COVENANT_PROTOCOL_TRUST_CAP = 22;
const CHECK_POINTS: Partial<Record<CovenantCheckId, number>> = {
  identity_binding: 4,
  manifest_binding: 3,
  audit_root_presence: 5,
  signature_match: 5,
  audit_root_recomputation: 5,
};
const INDEXED_ONLY_POINTS = 3;
export type CovenantScoreContribution = {
  points: number;
  reasons: string[];
};
export function covenantScoreContribution(input: {
  sapProtocols?: string[] | null;
  snapshot?: CovenantVerificationSnapshot | null;
}): CovenantScoreContribution {
  if (!isCovenantAgent(input.sapProtocols)) {
    return { points: 0, reasons: [] };
  }
  const reasons: string[] = ["OpenCovenant: runtime protocol detected"];
  let points = INDEXED_ONLY_POINTS;
  const snapshot = input.snapshot;
  if (!snapshot?.checks) {
    return { points: Math.min(points, COVENANT_PROTOCOL_TRUST_CAP), reasons };
  }
  for (const [id, state] of Object.entries(snapshot.checks) as Array<
    [CovenantCheckId, string]
  >) {
    if (state !== "pass") continue;
    const label = CHECK_REASON[id];
    if (label && !reasons.includes(label)) reasons.push(label);
    points += CHECK_POINTS[id] ?? 0;
  }
  return {
    points: Math.min(points, COVENANT_PROTOCOL_TRUST_CAP),
    reasons: reasons.slice(0, 8),
  };
}