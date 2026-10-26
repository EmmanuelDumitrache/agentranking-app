import { runMemoryExtractJob } from "@/features/agent-memory/server/extract";
import type { MemoryExtractPayload } from "@/jobs/contracts";

export async function agentMemoryExtractJob(payload: MemoryExtractPayload) {
  return runMemoryExtractJob(payload);
}
