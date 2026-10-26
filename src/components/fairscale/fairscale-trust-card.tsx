"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useEffect, useState, useTransition } from "react";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { useRouter } from "next/navigation";
import { ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { FAIRSCALE_METHODOLOGY_URL } from "@/lib/fairscale/config";
import { FAIRSCALE_LOGO_SRC } from "@/lib/fairscale/urls";
import { showToast } from "@/components/ui/toast-simple";
import {
  FAIRSCALE_CARD_TITLE,
  FAIRSCALE_NOT_DETECTED_COPY,
  FAIRSCALE_REQUEST_BUTTON,
  FAIRSCALE_REQUESTING_BUTTON,
  FAIRSCALE_TOAST_COOLDOWN,
  FAIRSCALE_TOAST_FAILED,
  FAIRSCALE_TOAST_REFRESHED,
  FAIRSCALE_TOAST_SAVED,
} from "@/lib/fairscale/copy";
import { fairscaleTierBadgeClassName, fairscaleRecommendationClassName } from "@/lib/fairscale/colors";
import type { FairscalePublicAssessment } from "@/lib/fairscale/types";
import { trackFairscaleEvent } from "@/lib/fairscale/track-client";
type Props = {
  readonly assessment: FairscalePublicAssessment;
  readonly agentDbId?: number;
  /** Required for manual Request assessment (API path). */
  readonly chainId?: number;
  readonly agentId?: number;
  readonly className?: string;
  /** Nest inside Identity & Verification — matches inset row chrome. */
  readonly variant?: "card" | "embedded";
};
function refreshCooldownLabel(nextRefreshAt: string | null | undefined): string | null {
  if (!nextRefreshAt) return null;
  const ms = new Date(nextRefreshAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours >= 24) return `in ${Math.ceil(hours / 24)}d`;
  if (hours >= 1) return `in ${hours}h`;
  return "soon";
}
export function FairscaleTrustCard({
  assessment: initialAssessment,
  agentDbId,
  chainId,
  agentId,
  className,
  variant = "card",
}: Props) {
  const router = useRouter();
  const assessmentSourceKey = [
    initialAssessment.status,
    initialAssessment.score ?? "",
    initialAssessment.scoredAt ?? "",
    initialAssessment.nextRefreshAt ?? "",
  ].join(":");
  const [assessment, setAssessment] = useSourceDraft(assessmentSourceKey, initialAssessment);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const embedded = variant === "embedded";
  const canRequest =
    typeof chainId === "number" &&
    Number.isFinite(chainId) &&
    typeof agentId === "number" &&
    Number.isFinite(agentId) &&
    assessment.status !== "missing_wallet" &&
    assessment.status !== "unsupported_network";
  useEffect(() => {
    void trackFairscaleEvent({
      eventType: "fairscale_card_viewed",
      agentDbId,
    });
    if (assessment.status !== "scored") {
      void trackFairscaleEvent({
        eventType: "fairscale_unavailable_state_shown",
        agentDbId,
        metadata: { status: assessment.status },
      });
    }
  }, [agentDbId, assessment.status]);
  const scored = assessment.status === "scored" && assessment.score !== null;
  const cooldownLabel = refreshCooldownLabel(assessment.nextRefreshAt);
  const refreshOnCooldown = Boolean(cooldownLabel);
  const requestAssessment = () => {
    if (!canRequest || pending || refreshOnCooldown) return;
    setRequestError(null);
    void trackFairscaleEvent({
      eventType: "fairscale_assessment_requested",
      agentDbId,
      metadata: { chainId, agentId },
    });
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agents/${chainId}/${agentId}/fairscale`, {
          method: "POST",
          headers: { Accept: "application/json" },
        });
        const body = (await res.json().catch(() => null)) as {
          assessment?: FairscalePublicAssessment;
          error?: string;
          refreshed?: boolean;
          cooldown?: boolean;
        } | null;
        if (!res.ok || !body?.assessment) {
          const msg = body?.error || `Request failed (${res.status})`;
          setRequestError(msg);
          showToast(FAIRSCALE_TOAST_FAILED, "error");
          void trackFairscaleEvent({
            eventType: "fairscale_assessment_failed",
            agentDbId,
            metadata: { status: res.status, error: msg },
          });
          return;
        }
        setAssessment(body.assessment);
        if (body.cooldown) {
          showToast(FAIRSCALE_TOAST_COOLDOWN, "info");
        } else if (body.assessment.status === "scored") {
          showToast(
            scored ? FAIRSCALE_TOAST_REFRESHED : FAIRSCALE_TOAST_SAVED,
            "success",
          );
        }
        void trackFairscaleEvent({
          eventType: "fairscale_assessment_succeeded",
          agentDbId,
          metadata: {
            status: body.assessment.status,
            score: body.assessment.score,
            refreshed: body.refreshed === true,
            cooldown: body.cooldown === true,
          },
        });
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Request failed";
        setRequestError(msg);
        showToast(FAIRSCALE_TOAST_FAILED, "error");
        void trackFairscaleEvent({
          eventType: "fairscale_assessment_failed",
          agentDbId,
          metadata: { error: msg },
        });
      }
    });
  };
  return (
    <section
      className={cn(
        "overflow-hidden",
        embedded
          ? "rounded-md border border-border/50 bg-background/40"
          : "rounded-xl border border-border/60 bg-background/50",
        className,
      )}
    >
      <header
        className={cn(
          "flex items-center gap-2 border-b border-border/40 bg-muted/20",
          embedded ? "px-2.5 py-1.5" : "px-3.5 py-2",
        )}
      >
        <RuntimeImage
          src={FAIRSCALE_LOGO_SRC}
          alt=""
          width={14}
          height={14}
          className="h-3.5 w-3.5 shrink-0 object-contain invert dark:invert-0"
          aria-hidden
        />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/70">
          {FAIRSCALE_CARD_TITLE}
        </span>
        <a
          href={FAIRSCALE_METHODOLOGY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-foreground/55 transition-colors hover:text-foreground"
          onClick={() => {
            void trackFairscaleEvent({
              eventType: "fairscale_methodology_clicked",
              agentDbId,
            });
          }}
        >
          Docs
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </header>
      <div className={cn(embedded ? "px-2.5 py-2.5" : "px-3.5 py-3")}>
        {scored ? (
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 items-end gap-1.5">
              <span className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
                {assessment.score}
              </span>
              <span className="pb-0.5 text-[11px] font-medium leading-none text-foreground/55">
                /100
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {assessment.tier ? (
                <span className={fairscaleTierBadgeClassName(assessment.tier)}>
                  {assessment.tier}
                </span>
              ) : assessment.recommendationLabel ? (
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    fairscaleRecommendationClassName({
                      recommendationLabel: assessment.recommendationLabel,
                    }),
                  )}
                >
                  {assessment.recommendationLabel}
                </span>
              ) : null}
              {canRequest ? (
                <div className="flex items-center gap-1 border-l border-border/50 pl-2">
                  <button
                    type="button"
                    disabled={pending || refreshOnCooldown}
                    onClick={requestAssessment}
                    title={
                      refreshOnCooldown
                        ? `Next refresh ${cooldownLabel}`
                        : "Refresh assessment"
                    }
                    aria-label={
                      refreshOnCooldown
                        ? `Next refresh ${cooldownLabel}`
                        : "Refresh assessment"
                    }
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground/55 transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RefreshCw
                      className={cn("h-3.5 w-3.5", pending && "animate-spin")}
                      aria-hidden
                    />
                  </button>
                  {cooldownLabel ? (
                    <span className="min-w-[2.25rem] text-[10px] font-medium tabular-nums text-foreground/50">
                      {cooldownLabel}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-foreground/55">
              {FAIRSCALE_NOT_DETECTED_COPY}
            </p>
            {canRequest ? (
              <button
                type="button"
                disabled={pending || refreshOnCooldown}
                onClick={requestAssessment}
                title={refreshOnCooldown ? `Next refresh ${cooldownLabel}` : undefined}
                className="ui-btn ui-btn-secondary ui-btn-sm ui-btn-fit shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending
                  ? FAIRSCALE_REQUESTING_BUTTON
                  : refreshOnCooldown
                    ? `Retry ${cooldownLabel}`
                    : FAIRSCALE_REQUEST_BUTTON}
              </button>
            ) : null}
          </div>
        )}
        {requestError ? (
          <p className="mt-2 text-[11px] text-orange-400/90">{requestError}</p>
        ) : null}
      </div>
    </section>
  );
}
