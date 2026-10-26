"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CircleDollarSign,
  HelpCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CopyTradeConfigRow,
  CopyTradeLlmModelOption,
  DashboardCopyTradePageData,
} from "@/lib/agent-trading/copy-trade-page.server";
import type { CopyLeaderboardTrader } from "@/lib/agent-trading/copy-trade/types";
import { cn } from "@/lib/utils";

export type CopyTradeSetupDraft = {
  targetWallet: string;
  label: string;
  sizingMode: "proportional" | "fixed_usd" | "multiplier";
  portfolioAllocationPct: number;
  buyPercent: number;
  maxPositionUsd: number;
  loopCadenceSec: number;
  llmModelKey: string;
  llmBudgetUsd: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trader: CopyLeaderboardTrader | null;
  editingConfig?: CopyTradeConfigRow | null;
  initialData: DashboardCopyTradePageData;
  saving: boolean;
  onSubmit: (draft: CopyTradeSetupDraft) => void;
};

const ALLOCATION_PRESETS = [
  { label: "1/4", value: 25 },
  { label: "1/2", value: 50 },
  { label: "Full", value: 100 },
] as const;

function sizingModeFromConfig(
  value: string,
): CopyTradeSetupDraft["sizingMode"] {
  if (value === "fixed_usd" || value === "multiplier") return value;
  return "proportional";
}

function defaultDraft(
  trader: CopyLeaderboardTrader | null,
  models: CopyTradeLlmModelOption[],
  editingConfig?: CopyTradeConfigRow | null,
): CopyTradeSetupDraft {
  if (editingConfig) {
    return {
      targetWallet: editingConfig.targetWallet,
      label: editingConfig.label ?? "",
      sizingMode: sizingModeFromConfig(editingConfig.sizingMode),
      portfolioAllocationPct: editingConfig.portfolioAllocationPct,
      buyPercent: editingConfig.buyPercent,
      maxPositionUsd: editingConfig.maxPositionUsd ?? 500,
      loopCadenceSec: editingConfig.loopCadenceSec,
      llmModelKey: editingConfig.llmModelKey ?? models[0]?.modelKey ?? "",
      llmBudgetUsd: editingConfig.llmBudgetUsd ?? 50,
    };
  }
  const defaultModel =
    models.find((model) => model.isFree) ?? models.find((model) => model.isDefault) ?? models[0];
  return {
    targetWallet: trader?.wallet ?? "",
    label: trader?.label ?? (trader ? `Trader #${trader.rank}` : ""),
    sizingMode: "proportional",
    portfolioAllocationPct: 100,
    buyPercent: 25,
    maxPositionUsd: 500,
    loopCadenceSec: 10,
    llmModelKey: defaultModel?.modelKey ?? "",
    llmBudgetUsd: 50,
  };
}

function SectionLabel({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      <span>{children}</span>
      {hint ? (
        <span title={hint}>
          <HelpCircle className="size-3.5 opacity-60" />
        </span>
      ) : null}
    </div>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm transition-colors",
            value === option.value
              ? "border-emerald-500/60 bg-emerald-500/10 text-foreground"
              : "border-border/60 bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function CopyTradeSetupDialog({
  open,
  onOpenChange,
  trader,
  editingConfig = null,
  initialData,
  saving,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState<CopyTradeSetupDraft>(() =>
    defaultDraft(trader, initialData.llmModels, editingConfig),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draftSource, setDraftSource] = useState(() => ({
    open,
    trader,
    editingConfig,
    llmModels: initialData.llmModels,
  }));
  const isEditing = Boolean(editingConfig);

  if (
    draftSource.open !== open ||
    draftSource.trader !== trader ||
    draftSource.editingConfig !== editingConfig ||
    draftSource.llmModels !== initialData.llmModels
  ) {
    setDraftSource({
      open,
      trader,
      editingConfig,
      llmModels: initialData.llmModels,
    });
    if (open) {
      setDraft(defaultDraft(trader, initialData.llmModels, editingConfig));
      setShowAdvanced(Boolean(editingConfig));
    }
  }

  const selectedModel = useMemo(
    () => initialData.llmModels.find((model) => model.modelKey === draft.llmModelKey) ?? null,
    [draft.llmModelKey, initialData.llmModels],
  );

  const title = isEditing ? "Edit copy trade" : "Copy Spot Trader";

  const sizingHint =
    draft.sizingMode === "proportional"
      ? "Mirrors the same portfolio percentage as the leader."
      : draft.sizingMode === "fixed_usd"
        ? "Uses a fixed USD amount per mirrored trade."
        : "Scales leader size by a multiplier.";

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border/60 bg-card p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle className="text-left text-lg">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-5 py-4">
          <div
            className={cn(
              "flex items-start gap-3 rounded-xl border px-3 py-3 text-sm",
              selectedModel?.isFree
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200",
            )}
          >
            <CircleDollarSign className="mt-0.5 size-4 shrink-0" />
            <p>
              {selectedModel?.isFree
                ? "Using a free model — no LLM cost per cycle (subject to daily limits)."
                : "Using a paid model — each copy cycle draws from your LLM credits."}
            </p>
          </div>

          <section>
            <SectionLabel hint="Model used to evaluate leader trades each loop.">LLM model</SectionLabel>
            <select
              value={draft.llmModelKey}
              onChange={(e) => setDraft((prev) => ({ ...prev, llmModelKey: e.target.value }))}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            >
              {initialData.llmModels.length === 0 ? (
                <option value="">No models available</option>
              ) : (
                initialData.llmModels.map((model) => (
                  <option key={model.modelKey} value={model.modelKey}>
                    {model.label} ({model.isFree ? "free" : "paid"} · {model.providerLabel})
                  </option>
                ))
              )}
            </select>
          </section>

          <section>
            <SectionLabel hint="How mirrored trade size is calculated.">Sizing mode</SectionLabel>
            <SegmentedControl
              value={draft.sizingMode}
              options={[
                { value: "proportional", label: "Proportional" },
                { value: "fixed_usd", label: "Fixed USD" },
                { value: "multiplier", label: "Multiplier" },
              ]}
              onChange={(value) => setDraft((prev) => ({ ...prev, sizingMode: value }))}
            />
            <p className="mt-2 text-xs text-muted-foreground">{sizingHint}</p>
          </section>

          <section>
            <SectionLabel hint="Share of your portfolio allocated to this copy strategy.">
              Portfolio allocation
            </SectionLabel>
            <div className="flex flex-wrap items-center gap-2">
              {ALLOCATION_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, portfolioAllocationPct: preset.value }))
                  }
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm",
                    draft.portfolioAllocationPct === preset.value
                      ? "border-emerald-500/60 bg-emerald-500/10"
                      : "border-border/60",
                  )}
                >
                  {preset.label}
                </button>
              ))}
              <div className="flex items-center gap-1 rounded-lg border border-border/60 px-3 py-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={draft.portfolioAllocationPct}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      portfolioAllocationPct: Number.parseInt(e.target.value, 10) || 1,
                    }))
                  }
                  className="w-12 bg-transparent text-sm outline-none"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <SectionLabel>Max position (USD)</SectionLabel>
              <input
                type="number"
                min={1}
                value={draft.maxPositionUsd}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    maxPositionUsd: Number.parseFloat(e.target.value) || 1,
                  }))
                }
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <SectionLabel>Loop cadence (seconds)</SectionLabel>
              <input
                type="number"
                min={5}
                max={3600}
                value={draft.loopCadenceSec}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    loopCadenceSec: Number.parseInt(e.target.value, 10) || 10,
                  }))
                }
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <SectionLabel>LLM budget (USD)</SectionLabel>
              <input
                type="number"
                min={0}
                step={1}
                value={draft.llmBudgetUsd}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    llmBudgetUsd: Number.parseFloat(e.target.value) || 0,
                  }))
                }
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {showAdvanced ? "▾" : "▸"} Advanced options
          </button>

          {showAdvanced ? (
            <div className="grid gap-3 rounded-xl border border-border/60 bg-background/40 p-3">
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">Target wallet</span>
                <input
                  value={draft.targetWallet}
                  onChange={(e) => setDraft((prev) => ({ ...prev, targetWallet: e.target.value }))}
                  placeholder="Solana wallet address"
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">Label (optional)</span>
                <input
                  value={draft.label}
                  onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))}
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">Buy % of leader trade</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={draft.buyPercent}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      buyPercent: Number.parseInt(e.target.value, 10) || 1,
                    }))
                  }
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                />
              </label>
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              Copy trading mirrors leader spot buys/sells onto this agent&apos;s custodial wallet
              while the copy-trade worker is running. You can lose funds from slippage or leader
              drawdowns — only allocate capital you can afford to lose.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border/60 px-5 py-4 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(draft)}
            disabled={saving || !draft.targetWallet.trim() || !draft.llmModelKey}
          >
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {isEditing ? "Save changes" : "Start copying"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
