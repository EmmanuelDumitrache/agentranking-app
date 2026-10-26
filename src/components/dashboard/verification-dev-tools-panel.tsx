"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DevToolsFloatingWidget } from "@/components/dev/dev-tools-floating-widget";
import { showToast } from "@/components/ui/toast-simple";
import type {
  AccountVerificationLevel,
  AccountVerificationStatus,
} from "@/generated/prisma/client";

type DevTier = AccountVerificationLevel;

type Props = {
  currentLevel: DevTier;
  isVerified: boolean;
  status: AccountVerificationStatus;
  onApplied?: () => Promise<void> | void;
};

const TIER_OPTIONS: { value: DevTier; label: string; description: string }[] = [
  {
    value: "NONE",
    label: "Unverified",
    description: "Tier 1 — basic account only.",
  },
  {
    value: "INDIVIDUAL",
    label: "Individual",
    description: "Tier 2 — identity + card issuance.",
  },
  {
    value: "BUSINESS",
    label: "Business",
    description: "Tier 3 — business KYB.",
  },
];

export function VerificationDevToolsPanel({
  currentLevel,
  isVerified,
  status,
  onApplied,
}: Props) {
  const [tier, setTier] = useState<DevTier>(currentLevel);
  const [kycComplete, setKycComplete] = useState(isVerified);
  const [sourceState, setSourceState] = useState({ currentLevel, isVerified });
  const [busy, setBusy] = useState(false);

  if (
    sourceState.currentLevel !== currentLevel ||
    sourceState.isVerified !== isVerified
  ) {
    setSourceState({ currentLevel, isVerified });
    setTier(currentLevel);
    setKycComplete(isVerified);
  }

  async function applyState() {
    setBusy(true);
    try {
      const res = await fetch("/api/verification/account/dev-bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: tier,
          kycComplete,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update verification");

      const appliedLevel = (body.level as DevTier | undefined) ?? tier;
      const appliedVerified = Boolean(body.isVerified);
      setTier(appliedLevel);
      setKycComplete(appliedVerified);

      const tierLabel =
        TIER_OPTIONS.find((row) => row.value === appliedLevel)?.label ?? appliedLevel;
      showToast(
        appliedVerified
          ? `Account set to ${tierLabel} · KYC complete`
          : `Account set to unverified · KYC incomplete`,
        "success",
      );
      await onApplied?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update verification", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DevToolsFloatingWidget
      title="Verification dev"
      subtitle="Local dev only · updates account tier + KYC"
    >
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-[#212121] px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-foreground">KYC complete</p>
            <p className="text-xs text-muted-foreground">
              {kycComplete
                ? "Verified — tier cards unlock"
                : "Incomplete — shows unverified UI"}
            </p>
          </div>
          <Checkbox
            checked={kycComplete}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setKycComplete(next);
              if (!next) setTier("NONE");
            }}
            aria-label="KYC complete"
          />
        </label>

        <div className="grid gap-2">
          {TIER_OPTIONS.map((option) => {
            const selected = tier === option.value;
            const isCurrent =
              option.value === "NONE"
                ? !isVerified && currentLevel === "NONE"
                : isVerified && currentLevel === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTier(option.value)}
                disabled={!kycComplete && option.value !== "NONE"}
                className={[
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  selected
                    ? "border-amber-400/60 bg-amber-500/10"
                    : "border-border bg-[#212121] hover:bg-muted/20",
                  !kycComplete && option.value !== "NONE"
                    ? "cursor-not-allowed opacity-50"
                    : "",
                ].join(" ")}
              >
                <p className="text-sm font-medium text-foreground">
                  {option.label}
                  {isCurrent ? (
                    <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                      live
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {option.description}
                </p>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Live status:{" "}
          <span className="font-medium text-foreground">
            {isVerified ? "KYC complete" : status === "PENDING" ? "KYC pending" : "KYC incomplete"}
          </span>
          {" · "}
          <span className="font-medium text-foreground">{currentLevel}</span>
        </p>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={busy}
          onClick={() => void applyState()}
        >
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Apply
        </Button>
      </div>
    </DevToolsFloatingWidget>
  );
}
