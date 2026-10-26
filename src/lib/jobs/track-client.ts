"use client";
import type { JobInteractionEventType } from "@/lib/jobs/types";
export async function trackJobEvent(input: {
  eventType: JobInteractionEventType;
  jobId?: string;
  agentId?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await fetch("/api/jobs/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      keepalive: true,
    });
  } catch {
    // fire-and-forget
  }
}