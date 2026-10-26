export const WORKER_SEMANTIC_GENERATION =
  process.env.INDEXER_SEMANTIC_GENERATION?.trim() || "worker-semantics-v14";
export function isStaleSemanticGeneration(value: string | undefined): boolean {
  // Missing generation remains accepted for one compatibility window. Every newly
  // produced payload carries the current generation.
  return value != null && value !== WORKER_SEMANTIC_GENERATION;
}
