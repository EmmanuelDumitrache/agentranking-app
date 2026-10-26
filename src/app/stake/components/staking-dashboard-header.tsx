"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { StakingFlywheelHeroDiagram } from "@/app/stake/components/staking-flywheel-hero-diagram";
import { REWARD_POOLS, STAKE_PAGE_HERO, STAKE_REWARD_MODEL } from "@/lib/staking-config";
import { STAKE_SITE_EASE } from "@/app/stake/shell/motion/motion-variants";
import { cn } from "@/lib/utils";
export function StakingDashboardHeader({
  onHowItWorks,
}: {
  readonly onHowItWorks?: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <section className="relative py-10 sm:py-14 lg:py-16">
      <div className="ar-public-container relative mx-auto max-w-4xl">
        <motion.div
          className="mx-auto max-w-2xl text-center"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: STAKE_SITE_EASE }}
        >
          <p className="ar-public-label mb-3">{STAKE_PAGE_HERO.eyebrow}</p>
          <h1 className="text-[clamp(2rem,4.5vw,3rem)] font-semibold leading-[1.06] tracking-tight text-[var(--ar-text-primary)]">
            {STAKE_PAGE_HERO.title}
            <span className="mt-1 block text-[clamp(1.5rem,3.2vw,2.25rem)] font-semibold text-[var(--ar-text-secondary)]">
              {STAKE_PAGE_HERO.titleLine2}
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[14px] leading-[1.55] text-[var(--ar-text-secondary)] sm:text-[15px]">
            {STAKE_PAGE_HERO.subcopy}
          </p>
        </motion.div>
        <StakingFlywheelHeroDiagram className="mx-auto mt-8 sm:mt-10" />
        <motion.div
          className="mt-8 flex flex-wrap items-center justify-center gap-2 sm:mt-10"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: STAKE_SITE_EASE, delay: 0.18 }}
        >
          <a href="#stake" className="ar-public-btn ar-public-btn-primary">
            Connect wallet
          </a>
          {onHowItWorks ? (
            <button type="button" className="ar-public-btn" onClick={onHowItWorks}>
              How it works
            </button>
          ) : (
            <a href="#education" className="ar-public-btn">
              How it works
            </a>
          )}
        </motion.div>
        <motion.div
          className="ar-public-glass mx-auto mt-6 max-w-2xl rounded-xl p-4 sm:p-5"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: STAKE_SITE_EASE, delay: 0.24 }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-center sm:text-left">
              <p className="ar-public-label">Reward pools</p>
              <p className="mt-1 text-[10px] text-[var(--ar-text-muted)]">Lock longer for higher weighting</p>
            </div>
            <Link href="#tiers" className="ar-public-link text-center text-[11px] font-medium sm:text-right">
              Select lock period →
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {REWARD_POOLS.map((pool) => (
              <div
                key={pool.days}
                className={cn(
                  "rounded-lg border border-[var(--ar-border)] bg-[color-mix(in_oklab,var(--ar-glass-fill)_80%,transparent)] px-2.5 py-2 text-center",
                  pool.live && "border-[var(--ar-border-strong)]",
                )}
              >
                <p className="text-[11px] text-[var(--ar-text-secondary)]">{pool.lockPeriodLabel}</p>
                <p
                  className={cn(
                    "mt-0.5 text-[15px] font-semibold tabular-nums",
                    pool.live ? "text-[var(--ar-text-primary)]" : "text-[var(--ar-text-tertiary)]",
                  )}
                >
                  {pool.poolSharePct}%
                </p>
              </div>
            ))}
          </div>
        </motion.div>
        <p className="mx-auto mt-4 max-w-xl text-center text-[11px] leading-[1.45] text-[var(--ar-text-muted)]">
          {STAKE_REWARD_MODEL.disclaimer}
        </p>
      </div>
    </section>
  );
}
