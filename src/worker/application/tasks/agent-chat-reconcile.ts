import { reconcileStaleRuns } from "@/features/agent-chat/server/run/reconcile-runs";
export async function agentChatReconcileJob() {
  return reconcileStaleRuns();
}
