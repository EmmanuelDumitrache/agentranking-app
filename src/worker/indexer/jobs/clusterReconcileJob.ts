import { assignClusterForSeed } from "../sync/cluster-assignment.js";
import type { ClusterReconcilePayload } from "../queue/contracts.js";

export async function runClusterReconcileJob(payload: ClusterReconcilePayload): Promise<{ updated: boolean; deferredReason?: "cluster_reconcile_failed"; deferredDetail?: string }> {
  const result = await assignClusterForSeed(payload.chainId, payload.agentId);
  if (result.failed) {
    return {
      updated: false,
      deferredReason: "cluster_reconcile_failed",
      deferredDetail: result.error?.slice(0, 1_000) ?? undefined,
    };
  }
  return { updated: result.updated > 0 };
}
