"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerifiedTick } from "@/components/shared/verified-badge";
import { VerificationIdCard } from "@/components/dashboard/verification-id-card";
import type { AccountVerificationPageData } from "@/lib/verification/verification-page.server";
import { dashboardKeys } from "@/lib/query-keys/dashboard";

type Props = {
  readonly initialData: AccountVerificationPageData;
};

function formatVerifiedDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function LockedCredentialCard() {
  return (
    <div className="ui-credentials-locked" aria-hidden>
      <div className="ui-credentials-locked-card">
        <div className="ui-credentials-locked-hologram" />
        <p className="ui-credentials-locked-brand">AGENTRANKING</p>
        <p className="ui-credentials-locked-title">AgentRanking ID</p>
        <p className="ui-credentials-locked-code">AR-············</p>
      </div>
      <div className="ui-credentials-locked-veil" />
      <div className="ui-credentials-locked-stamp">
        <span className="ui-credentials-locked-stamp-icon">
          <Lock className="size-5" strokeWidth={1.75} />
        </span>
        <span className="ui-credentials-locked-stamp-label">Verification required</span>
      </div>
    </div>
  );
}

export function AccountCredentialsPage({ initialData }: Props) {
  const verificationQuery = useQuery({
    queryKey: dashboardKeys.accountVerification(),
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/verification/account", { signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load credentials");
      return body as {
        isVerified?: boolean;
        verification?: {
          publicId?: string;
          level?: string;
          status?: string;
          verifiedAt?: string | null;
        } | null;
      };
    },
    refetchOnMount: false,
  });

  const base = initialData;
  const api = verificationQuery.data;
  const apiVerification = api?.verification ?? null;
  const publicId = apiVerification?.publicId ?? base.verification?.publicId ?? "";
  const level = (apiVerification?.level ?? base.verification?.level ?? "NONE") as NonNullable<
    AccountVerificationPageData["verification"]
  >["level"];
  const status = (apiVerification?.status ??
    base.verification?.status ??
    "UNVERIFIED") as NonNullable<AccountVerificationPageData["verification"]>["status"];
  const verifiedAt = apiVerification?.verifiedAt
    ? new Date(apiVerification.verifiedAt)
    : (base.verification?.verifiedAt ?? null);
  const isVerified = api?.isVerified ?? base.verification?.isVerified ?? false;
  const pending = status === "PENDING" || status === "NEEDS_REVIEW";

  return (
    <div className="ui-youtube-page ui-credentials-page mx-auto w-full max-w-5xl space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Account credentials
        </p>
        <h1 className="ui-page-title">
          {isVerified ? "Your AgentRanking ID" : "Credentials"}
        </h1>
        <p className="ui-page-subtitle max-w-2xl">
          {isVerified
            ? "Your public identity card. Flip it to reveal the credential code — no personal data, not minted."
            : "Verify your account to unlock a public AgentRanking ID card for every agent you own."}
        </p>
      </div>

      {isVerified ? (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header flex items-start gap-3 px-5 py-4">
            <VerifiedTick size="md" tone="foreground" className="mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Public credential</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {level === "BUSINESS" ? "Business" : "Individual"} verification is active on this
                account.
              </p>
            </div>
          </div>

          <div className="border-b border-border px-5 py-6">
            <VerificationIdCard publicId={publicId} level={level} verifiedAt={verifiedAt} />
          </div>

          <dl className="grid gap-4 px-5 py-4 sm:grid-cols-3">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Credential ID
              </dt>
              <dd className="mt-1 font-mono text-sm text-foreground">{publicId || "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Coverage
              </dt>
              <dd className="mt-1 text-sm text-foreground">Tier 1 and Tier 2 complete</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Issued
              </dt>
              <dd className="mt-1 text-sm text-foreground">
                {formatVerifiedDate(verifiedAt) ?? "—"}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-3 border-t border-border bg-muted/20 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-muted-foreground">
              All agents on this account inherit verified status automatically.
            </p>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/dashboard/verify">Manage verification</Link>
            </Button>
          </div>
        </section>
      ) : (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Identity required
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Unlock your ID card</h2>
          </div>
          <div className="space-y-5 px-5 py-8">
            <LockedCredentialCard />
            <div className="mx-auto max-w-md space-y-3 text-center">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Complete KYC on Verification to unlock this card. One identity check covers every
                agent you own — no personal data on the card, and nothing is minted on-chain.
              </p>
              {pending ? (
                <p className="text-xs text-amber-500">
                  {status === "NEEDS_REVIEW"
                    ? "Verification is under review. Your card unlocks when approved."
                    : "Verification is in progress. Finish KYC to unlock this card."}
                </p>
              ) : null}
              <Button asChild className="gap-1.5">
                <Link href="/dashboard/verify">
                  {pending ? "Continue verification" : "Go to Verification"}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
