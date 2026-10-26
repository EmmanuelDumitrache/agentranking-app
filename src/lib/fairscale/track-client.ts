"use client";

export type FairscaleTrackEvent =
  | "fairscale_card_viewed"
  | "fairscale_breakdown_opened"
  | "fairscale_methodology_clicked"
  | "fairscale_assessment_requested"
  | "fairscale_assessment_succeeded"
  | "fairscale_assessment_failed"
  | "fairscale_unavailable_state_shown";

export async function trackFairscaleEvent(input: {
  eventType: FairscaleTrackEvent;
  agentDbId?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await fetch("/api/fairscale/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      keepalive: true,
    });
  } catch {
    // fire-and-forget
  }
}
