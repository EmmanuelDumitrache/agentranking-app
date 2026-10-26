"use client";
import { useCallback, useRef, useState } from "react";
import type { StakeLockDays } from "@/lib/stake-lock-periods";
import type { StakePageMetricsDto } from "@/lib/stake-page-data";
import type { StreamflowPoolConfigDto } from "@/lib/streamflow-stake-config";
import { LockPoolTable } from "./lock-pool-table";
import { RecentActivitySection } from "./recent-activity-section";
import { StakeEducationAccordion } from "./stake-education-accordion";
import { StakingInteractionSection } from "./staking-interaction-section";
export function StakePageBody({
  initialMetrics,
  initialPoolConfig,
}: {
  readonly initialMetrics?: StakePageMetricsDto | null;
  readonly initialPoolConfig?: StreamflowPoolConfigDto | null;
}) {
  const [selectedLockDays, setSelectedLockDays] = useState<StakeLockDays>(30);
  const hasScrolledToStakeRef = useRef(false);
  const onSelectTier = useCallback((days: StakeLockDays) => {
    setSelectedLockDays(days);
    if (hasScrolledToStakeRef.current) return;
    hasScrolledToStakeRef.current = true;
    const el = document.getElementById("stake");
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, []);
  return (
    <>
      <StakingInteractionSection
        selectedLockDays={selectedLockDays}
        onSelectedLockDaysChange={setSelectedLockDays}
        initialMetrics={initialMetrics}
        initialPoolConfig={initialPoolConfig}
      />
      <LockPoolTable selectedDays={selectedLockDays} onSelectDays={onSelectTier} />
      <RecentActivitySection />
      <StakeEducationAccordion />
    </>
  );
}
