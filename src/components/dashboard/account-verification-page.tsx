"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BadgeCheck,
  Building2,
  Check,
  Clock,
  CreditCard,
  Loader2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerifiedTick } from "@/components/shared/verified-badge";
import { showToast } from "@/components/ui/toast-simple";
import { VerificationDevToolsPanel } from "@/components/dashboard/verification-dev-tools-panel";
import type { AccountVerificationPageData } from "@/lib/verification/verification-page.server";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import { cn } from "@/lib/utils";

type VerificationSessionResponse = {
  sessionId: string;
  url: string;
  provider: string;
  embedded?: {
    inquiryId: string;
    environmentId: string;
    sessionToken?: string | null;
  } | null;
  error?: string;
  code?: string;
};

type Props = {
  initialData: AccountVerificationPageData;
};

function TierFeature({ children }: { children: React.ReactNode }) {
  return (
    <li className="text-sm leading-snug text-muted-foreground">{children}</li>
  );
}

type VerificationTierCardProps = {
  overline: string;
  title: string;
  description: string;
  verification: string;
  icon: LucideIcon;
  price?: string;
  priceNote?: string;
  headerBanner?: React.ReactNode;
  features: readonly string[];
  footer: React.ReactNode;
  highlighted?: boolean;
};

function VerificationTierCard({
  overline,
  title,
  description,
  verification,
  icon: Icon,
  price,
  priceNote,
  headerBanner,
  features,
  footer,
  highlighted = false,
}: VerificationTierCardProps) {
  return (
    <section
      className={cn(
        "ui-overview-panel ui-verification-tier flex h-full flex-col overflow-hidden rounded-xl p-0",
        highlighted && "ui-verification-tier--highlighted",
      )}
    >
      <div className="ui-overview-panel-header px-5 py-4">
        <div className="flex items-start gap-2.5">
          <Icon
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {overline}
            </p>
            <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">{title}</h2>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{description}</p>
        <p className="mt-2 text-xs font-medium text-foreground/80">{verification}</p>
        {headerBanner ? (
          <div className="mt-4">{headerBanner}</div>
        ) : price ? (
          <div className="mt-4">
            <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {price}
            </p>
            {priceNote ? (
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{priceNote}</p>
            ) : null}
          </div>
        ) : null}
      </div>
      <ul className="flex-1 list-disc space-y-3 px-5 py-5 pl-8 marker:text-muted-foreground/50">
        {features.map((feature) => (
          <TierFeature key={feature}>{feature}</TierFeature>
        ))}
      </ul>
      <div className="ui-verification-tier-footer border-t px-5 py-4">{footer}</div>
    </section>
  );
}

function CurrentLevelBadge() {
  return (
    <span className="ui-verification-tier-control inline-flex w-full items-center justify-center px-4 text-xs font-medium text-muted-foreground">
      Current plan
    </span>
  );
}

function TierStatusBadge({ label }: { label: string }) {
  return (
    <span className="ui-verification-tier-control inline-flex w-full items-center justify-center gap-1.5 px-4 text-xs font-medium text-foreground">
      <Check className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {label}
    </span>
  );
}

function VerifiedTierBanner({ isCurrent = false }: { isCurrent?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-foreground/10 bg-muted/25 px-3.5 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-background shadow-sm">
        <VerifiedTick size="sm" tone="foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">Verified</p>
          {isCurrent ? (
            <span className="rounded-full border border-foreground/15 bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Current plan
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {isCurrent ? "Identity verification active on your account" : "Included in your plan"}
        </p>
      </div>
    </div>
  );
}

function CardIssueCta() {
  return (
    <Button asChild variant="secondary" size="sm" className="ui-verification-tier-action w-full">
      <Link href="/dashboard/card">
        <CreditCard className="mr-2 size-4" aria-hidden />
        Get your card
      </Link>
    </Button>
  );
}

export function AccountVerificationPage({ initialData }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verificationQuery = useQuery({
    queryKey: dashboardKeys.accountVerification(),
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/verification/account", { signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load verification");
      return body as {
        enabled?: boolean;
        devBypassAvailable?: boolean;
        isVerified?: boolean;
        eligibility?: { canIssueCards?: boolean };
        verification?: {
          publicId?: string;
          level?: string;
          status?: string;
          verifiedAt?: string | null;
          expiresAt?: string | null;
        } | null;
      };
    },
    refetchOnMount: false,
  });
  const refresh = useCallback(
    () => verificationQuery.refetch().then(() => undefined),
    [verificationQuery],
  );

  const syncAndRefresh = useCallback(async () => {
    try {
      await fetch("/api/verification/account/sync", { method: "POST" });
    } catch {
      // Sync is best-effort; refresh still updates the page.
    }
    await refresh();
  }, [refresh]);

  const base = initialData;
  const api = verificationQuery.data;
  const apiVerification = api?.verification ?? null;
  const verification = {
    appAccountId: base.verification?.appAccountId ?? "",
    publicId: apiVerification?.publicId ?? base.verification?.publicId ?? "",
    level: (apiVerification?.level ?? base.verification?.level ?? "NONE") as NonNullable<AccountVerificationPageData["verification"]>["level"],
    status: (apiVerification?.status ?? base.verification?.status ?? "UNVERIFIED") as NonNullable<AccountVerificationPageData["verification"]>["status"],
    verifiedAt: apiVerification?.verifiedAt
      ? new Date(apiVerification.verifiedAt)
      : (base.verification?.verifiedAt ?? null),
    expiresAt: apiVerification?.expiresAt
      ? new Date(apiVerification.expiresAt)
      : (base.verification?.expiresAt ?? null),
    revokedAt: base.verification?.revokedAt ?? null,
    isVerified: api?.isVerified ?? base.verification?.isVerified ?? false,
    canIssueCards:
      api?.eligibility?.canIssueCards ?? base.verification?.canIssueCards ?? false,
    credential: (apiVerification ?? base.verification?.credential) as NonNullable<AccountVerificationPageData["verification"]>["credential"],
  };
  const data = {
    enabled: api?.enabled ?? base.enabled,
    devBypassAvailable: api?.devBypassAvailable ?? base.devBypassAvailable,
    cardPreviewEnabled: base.cardPreviewEnabled,
    kycProvider: base.kycProvider,
    personaEmbeddedReady: base.personaEmbeddedReady,
    verification,
  };

  const isVerified = verification?.isVerified ?? false;
  const status = verification?.status ?? "UNVERIFIED";
  const verificationButtonLabel =
    status === "PENDING" ? "Continue verification" : "Start verification";

  const runVerificationSession = useCallback(
    async (body: VerificationSessionResponse) => {
      if (body.provider === "mock") {
        const res = await fetch("/api/verification/account/mock-complete", { method: "POST" });
        const mockBody = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(mockBody.error ?? "Mock verification failed");
        }
        await refresh();
        showToast("Account verified (local mock KYC)", "success");
        router.push("/dashboard/credentials");
        return;
      }

      if (body.embedded) {
        const { openPersonaEmbeddedInquiry } = await import(
          "@/lib/verification/persona-embedded-client"
        );
        const result = await openPersonaEmbeddedInquiry({
          inquiryId: body.embedded.inquiryId,
          environmentId: body.embedded.environmentId,
          sessionToken: body.embedded.sessionToken,
        });

        if (result.status === "error") {
          throw new Error(result.message);
        }

        if (result.status === "cancelled") {
          showToast("Verification closed. You can continue anytime.", "info");
          return;
        }

        if (result.status === "completed") {
          await syncAndRefresh();
          showToast("Verification submitted. Syncing status…", "success");

          for (let attempt = 0; attempt < 6; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 2_000));
            await syncAndRefresh();
          }
        }

        return;
      }

      window.location.assign(body.url);
    },
    [refresh, router, syncAndRefresh],
  );

  const verificationReady =
    data.kycProvider === "mock" || data.personaEmbeddedReady;

  const startVerification = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/verification/account/session", { method: "POST" });
      const body = (await res.json()) as VerificationSessionResponse;
      if (!res.ok) {
        if (res.status === 409 && body.code === "already_verified") {
          await refresh();
          showToast("Your account is already verified.", "success");
          router.push("/dashboard/credentials");
          return;
        }
        throw new Error(body.error ?? "Could not start verification");
      }
      await runVerificationSession(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start verification";
      setError(message);
      showToast(message, "error");
    } finally {
      setBusy(false);
    }
  }, [refresh, router, runVerificationSession]);

  const skipLocalKyc = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/verification/account/dev-bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: "INDIVIDUAL", kycComplete: true }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not skip verification");
      await refresh();
      showToast("Account verified (local skip)", "success");
      router.push("/dashboard/credentials");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not skip verification";
      setError(message);
      showToast(message, "error");
    } finally {
      setBusy(false);
    }
  }, [refresh, router]);

  useEffect(() => {
    if (searchParams.get("status") !== "complete") return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void syncAndRefresh().finally(() => {
        if (active) {
          router.replace("/dashboard/verify", { scroll: false });
        }
      });
    });
    return () => {
      active = false;
    };
  }, [router, searchParams, syncAndRefresh]);

  const level = verification?.level ?? "NONE";
  const isBusinessVerified = isVerified && level === "BUSINESS";
  const isIndividualVerified = isVerified && level === "INDIVIDUAL";
  const basicIsCurrent = !isVerified && status === "UNVERIFIED";
  const tier2IsCurrent = isIndividualVerified;
  const tier3IsCurrent = isBusinessVerified;

  return (
    <div className="ui-youtube-page ui-verification-page mx-auto w-full max-w-5xl space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Account verification
        </p>
        <h1 className="ui-page-title">
          {isVerified ? "Your verification status" : "Verify your AgentRanking account"}
        </h1>
        <p className="ui-page-subtitle max-w-2xl">
          {isVerified
            ? "Your account verification applies to every agent you own. Upgrade to Business when KYB is available."
            : "One verification applies to every agent you own. Upgrade when you need verified identity and payment eligibility."}
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-300/40 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {!data.personaEmbeddedReady && data.kycProvider === "persona" && !isVerified ? (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Identity verification is temporarily unavailable</p>
          <p className="mt-1 text-muted-foreground">
            Persona is not fully configured on this environment. Please try again later or contact
            support if the issue persists.
          </p>
        </div>
      ) : null}

      {status === "PENDING" || status === "NEEDS_REVIEW" ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300/30 bg-amber-50/50 px-4 py-3 text-sm dark:bg-amber-950/20">
          <Clock className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-foreground">
              {status === "NEEDS_REVIEW" ? "Verification under review" : "Verification in progress"}
            </p>
            <p className="mt-1 text-muted-foreground">
              {status === "NEEDS_REVIEW"
                ? "Our team or provider is reviewing your submission. You will be notified when complete."
                : "Complete the identity flow if you have not already. Status updates automatically."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {status === "PENDING" ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !data.enabled || !verificationReady}
                  onClick={() => void startVerification()}
                >
                  {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Continue verification
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void syncAndRefresh()}
              >
                Refresh status
              </Button>
              {data.devBypassAvailable ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void skipLocalKyc()}
                >
                  Skip KYC (local)
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {status === "DECLINED" ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-300/30 bg-red-50/50 px-4 py-3 text-sm dark:bg-red-950/20">
          <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
          <div>
            <p className="font-medium text-foreground">Verification declined</p>
            <p className="mt-1 text-muted-foreground">
              You can try again or contact support if you believe this is an error.
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-3"
              disabled={busy || !verificationReady}
              onClick={() => void startVerification()}
            >
              Try again
            </Button>
          </div>
        </div>
      ) : null}

      {isVerified && verification ? (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header flex items-start gap-3 px-5 py-4">
            <VerifiedTick size="md" tone="foreground" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Account credential</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {level === "BUSINESS" ? "Business" : "Individual"} verification is active. Your
                public ID card lives under Credentials.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-mono text-sm text-foreground">{verification.publicId}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm">
                <Link href="/dashboard/credentials">View ID card</Link>
              </Button>
              {data.cardPreviewEnabled ? (
                <Button asChild variant="outline" size="sm">
                  <Link href="/dashboard/card">Agentic payments</Link>
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <VerificationTierCard
          overline="Tier 1"
          title="Basic"
          icon={Check}
          description="Standard platform access for operators and builders"
          verification="Verification: not required"
          price="Free"
          priceNote="Included with account"
          features={[
            "Create and manage agents",
            "Public agent profiles and indexing",
            "Platform dashboard access",
            "AgentCard single-use spend cards (no AR KYC)",
            "Persistent AR card issuance not included",
          ]}
          highlighted={basicIsCurrent}
          footer={
            isVerified ? (
              <TierStatusBadge label="Included" />
            ) : basicIsCurrent ? (
              <CurrentLevelBadge />
            ) : null
          }
        />

        <VerificationTierCard
          overline="Tier 2"
          title="Verified identity"
          icon={BadgeCheck}
          description="KYC identity verification unlocks the verified badge and trusted social links on every agent you own"
          verification="Verification: identity + trusted social links"
          headerBanner={
            tier2IsCurrent ? <VerifiedTierBanner isCurrent /> : undefined
          }
          features={[
            "KYC identity verification (Persona)",
            "Trusted website and social links",
            "Verified badge on all owned agents",
            "Public verification credential (AR ID)",
            "AR virtual card issuance (coming soon)",
            "Everything in Basic",
          ]}
          highlighted={
            tier2IsCurrent || status === "PENDING" || status === "NEEDS_REVIEW"
          }
          footer={
            isIndividualVerified || isBusinessVerified ? (
              tier2IsCurrent ? (
                data.cardPreviewEnabled ? (
                  <CardIssueCta />
                ) : (
                  <TierStatusBadge label="Verified" />
                )
              ) : (
                <TierStatusBadge label="Verified" />
              )
            ) : (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="ui-verification-tier-action w-full"
                  disabled={busy || !data.enabled || !verificationReady}
                  onClick={() => void startVerification()}
                >
                  {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  {verificationButtonLabel}
                </Button>
                {data.devBypassAvailable ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ui-verification-tier-action w-full"
                    disabled={busy}
                    onClick={() => void skipLocalKyc()}
                  >
                    Skip KYC (local)
                  </Button>
                ) : null}
              </div>
            )
          }
        />

        <VerificationTierCard
          overline="Tier 3"
          title="Business"
          icon={Building2}
          description="Organization verification for teams and institutions"
          verification="Verification: business entity (KYB)"
          price="Custom"
          priceNote="Contact for quote"
          headerBanner={
            isBusinessVerified ? <VerifiedTierBanner isCurrent /> : undefined
          }
          features={[
            "Everything in Verify + Card issuance",
            "Business KYB and entity verification",
            "Higher limits and program controls",
            "Dedicated onboarding and support",
            "Custom issuer and treasury terms",
          ]}
          highlighted={tier3IsCurrent}
          footer={
            isBusinessVerified ? (
              <CardIssueCta />
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="ui-verification-tier-action w-full"
                disabled
              >
                Contact sales · Coming soon
              </Button>
            )
          }
        />
      </div>

      {data.devBypassAvailable ? (
        <VerificationDevToolsPanel
          currentLevel={level}
          isVerified={isVerified}
          status={status}
          onApplied={refresh}
        />
      ) : null}
    </div>
  );
}
