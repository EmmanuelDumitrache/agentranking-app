import { reconcileGenerationAttempt } from "@/lib/llm-provider/openrouter-reconciliation";
export async function openRouterReconciliationJob(attemptId: string) {
  const result = await reconcileGenerationAttempt(attemptId);
  if (result.status === "RETRYING") {
    throw new Error(`OpenRouter generation ${attemptId} not available yet`);
  }
  return result;
}
