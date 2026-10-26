"use client";

import Link from "next/link";
import { ArrowRight, BadgeCheck, CreditCard, MessageSquare, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VirtualPaymentCard } from "@/components/treasury/virtual-payment-card";
import type { AccountVerificationSnapshot } from "@/lib/verification/account-verification-types";

type Props = {
  verification: AccountVerificationSnapshot | null;
  hasCards?: boolean;
  primaryAgentDbId?: number | null;
  children: React.ReactNode;
};

function TierMeta({
  icon: Icon,
  label,
}: {
  icon: typeof Wallet;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      {label}
    </span>
  );
}

export function ArCardVerificationGate({
  verification,
  hasCards = false,
  primaryAgentDbId = null,
  children,
}: Props) {
  const isVerified = verification?.isVerified ?? false;
  const agentBase =
    primaryAgentDbId != null ? `/dashboard/agents/${primaryAgentDbId}` : null;

  if (isVerified) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-5">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity px-4 py-3.5 sm:px-5">
          <h1 className="text-xl font-semibold tracking-tight">Payment cards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fund agent spending or verify to issue reusable virtual cards.
          </p>
        </div>
      </div>
      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Tier 1
          </p>
        </div>
        <div className="p-5 sm:p-6">
          <div className="flex min-w-0 items-start gap-3.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-foreground/10 bg-muted/40">
              <Wallet className="size-5 text-foreground" strokeWidth={1.75} aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <TierMeta icon={Wallet} label="Wallet funded" />
                <span className="text-muted-foreground/40" aria-hidden>
                  ·
                </span>
                <TierMeta icon={BadgeCheck} label="No KYC" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Agents can spend today
              </h2>
              <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                Fund an agent wallet and they pay online through AgentCard — no verification needed.
              </p>
              {agentBase ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <Link href={`${agentBase}/wallet`}>
                      <Wallet className="size-3.5" aria-hidden />
                      Fund agent wallet
                    </Link>
                  </Button>
                  <Button asChild size="sm" className="gap-1.5">
                    <Link href={`${agentBase}/chat`}>
                      <MessageSquare className="size-3.5" aria-hidden />
                      Open agent chat
                    </Link>
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Tier 2
          </p>
        </div>
        <div className="p-5 sm:p-6">
          <div className="flex items-start gap-3.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-foreground/10 bg-muted/40">
              <CreditCard className="size-5 text-foreground" strokeWidth={1.75} aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <h3 className="text-xl font-semibold tracking-tight text-foreground">
                Get your own virtual cards
              </h3>
              <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
                Issue reusable AR cards for your agents. Freeze, set a PIN, and top up when you need
                more spend.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-center">
            <VirtualPaymentCard details={null} />
          </div>

          <div className="mt-5 flex flex-col items-center gap-2">
            <Button asChild className="gap-1.5">
              <Link href="/dashboard/verify">
                Verify to unlock
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            {verification &&
            (verification.status === "PENDING" || verification.status === "NEEDS_REVIEW") ? (
              <p className="text-center text-xs text-amber-600 dark:text-amber-400">
                Verification in progress — cards unlock when approved.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {hasCards ? <div className="opacity-90">{children}</div> : null}
    </div>
  );
}
