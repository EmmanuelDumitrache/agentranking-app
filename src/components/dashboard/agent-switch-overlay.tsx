"use client";

import { DashboardLoadingSequence } from "@/components/dashboard/dashboard-loading-sequence";

type Props = {
  readonly agentName?: string | null;
};

/** Full-bleed cover over main content while an agent switch navigation completes. */
export function DashboardAgentSwitchOverlay({ agentName }: Props) {
  const label = agentName?.trim()
    ? `Loading ${agentName.trim()}`
    : "Switching agent";
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-background/88 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <DashboardLoadingSequence />
    </div>
  );
}
