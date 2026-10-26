import { prisma } from "@/lib/db";
import { hashClientIp } from "@/lib/jobs/hash";
import { JOB_INTERACTION_EVENT_TYPES, type JobInteractionEventType } from "@/lib/jobs/types";
import type { Prisma } from "@/generated/prisma/client";
const ALLOWED = new Set<string>(JOB_INTERACTION_EVENT_TYPES);
export function isAllowedJobEventType(eventType: string): eventType is JobInteractionEventType {
  return ALLOWED.has(eventType);
}
export async function recordJobInteractionEvent(input: {
  eventType: JobInteractionEventType;
  jobId?: string;
  agentId?: number;
  source?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  await prisma.jobInteractionEvent.create({
    data: {
      eventType: input.eventType,
      jobId: input.jobId,
      agentId: input.agentId,
      source: input.source,
      metadata: input.metadata as Prisma.InputJsonValue,
      ipHash: input.ip ? hashClientIp(input.ip) : null,
    },
  });
}