"use client";
import { Coins, Infinity, Landmark } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  STAKING_FEE_ALLOCATION_PCT,
  STAKING_TREASURY_ALLOCATION_PCT,
} from "@/lib/staking-config";
import { STAKE_SITE_EASE } from "@/app/stake/shell/motion/motion-variants";
import { cn } from "@/lib/utils";
function FlywheelRing() {
  const reduce = useReducedMotion();
  return (
    <div className="ar-stake-flywheel-hub relative mx-auto flex h-[7.5rem] w-[7.5rem] items-center justify-center sm:h-[8.5rem] sm:w-[8.5rem]">
      <svg
        className={cn("absolute inset-0 h-full w-full", !reduce && "ar-stake-flywheel-ring")}
        viewBox="0 0 120 120"
        aria-hidden
      >
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth="1.5"
        />
        <path
          d="M 60 8 A 52 52 0 0 1 112 60"
          fill="none"
          stroke="rgba(255, 255, 255, 0.72)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M 60 112 A 52 52 0 0 1 8 60"
          fill="none"
          stroke="rgba(255, 255, 255, 0.45)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <polygon points="108,52 112,60 104,60" fill="rgba(255, 255, 255, 0.72)" />
        <polygon points="12,68 8,60 16,60" fill="rgba(255, 255, 255, 0.45)" />
      </svg>
      <div className="ar-stake-flywheel-hub-core flex h-14 w-14 items-center justify-center rounded-full sm:h-16 sm:w-16">
        <Infinity className="h-7 w-7 text-[var(--ar-text-primary)] sm:h-8 sm:w-8" strokeWidth={1.75} aria-hidden />
      </div>
    </div>
  );
}
function AllocationColumn({
  pct,
  label,
  icon: Icon,
  side,
}: {
  readonly pct: number;
  readonly label: string;
  readonly icon: typeof Coins;
  readonly side: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 text-center",
        side === "left" ? "lg:items-end lg:text-right" : "lg:items-start lg:text-left",
      )}
    >
      <div>
        <p className="text-[clamp(2.25rem,5vw,3rem)] font-semibold leading-none tabular-nums tracking-tight text-[var(--ar-text-primary)]">
          {pct}%
        </p>
        <p className="mt-2 max-w-[11rem] text-[12px] leading-[1.45] text-[var(--ar-text-secondary)] sm:text-[13px]">
          {label}
        </p>
      </div>
      <div className="ar-stake-flywheel-icon-pedestal flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl sm:h-20 sm:w-20">
        <Icon className="h-8 w-8 text-[var(--ar-text-primary)] opacity-90" strokeWidth={1.5} aria-hidden />
      </div>
    </div>
  );
}
export function StakingFlywheelHeroDiagram({ className }: { readonly className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cn("w-full", className)}
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: STAKE_SITE_EASE, delay: 0.1 }}
    >
      <div className="px-2 py-2 sm:px-4">
        <div className="mx-auto max-w-lg text-center">
          <p className="text-[clamp(1.125rem,2.5vw,1.5rem)] font-semibold leading-tight tracking-tight text-[var(--ar-text-primary)]">
            Sustainable flywheel ecosystem
          </p>
          <p className="mt-2 text-[12px] leading-[1.5] text-[var(--ar-text-secondary)] sm:text-[13px]">
            100% of selected platform fees rotate back into the project
          </p>
        </div>
        <div className="mx-auto mt-8 grid max-w-3xl grid-cols-1 items-center gap-8 sm:mt-10 lg:grid-cols-[1fr_auto_1fr] lg:gap-6">
          <AllocationColumn
            side="left"
            pct={STAKING_FEE_ALLOCATION_PCT}
            label="Buybacks + staking rewards"
            icon={Coins}
          />
          <FlywheelRing />
          <AllocationColumn
            side="right"
            pct={STAKING_TREASURY_ALLOCATION_PCT}
            label="Treasury"
            icon={Landmark}
          />
        </div>
        <p className="mx-auto mt-8 max-w-md text-center text-[11px] leading-[1.45] text-[var(--ar-text-tertiary)] sm:text-[12px]">
          Built to strengthen the <span className="font-medium text-[var(--ar-text-secondary)]">$AR</span>{" "}
          ecosystem — variable rewards, not fixed APY.
        </p>
      </div>
    </motion.div>
  );
}
