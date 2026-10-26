"use client";

import { memo } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientModelOption } from "../shared/contracts";
import { AgentChatModelPicker } from "./AgentChatModelPicker";

interface Props {
  agentName: string;
  onOpenSettings: () => void;
  modelKey: string;
  onModelSelect: (modelKey: string) => void;
  models: ClientModelOption[];
  modelsLoading: boolean;
  modelsError: boolean;
  onRetryModels: () => void;
  isStreaming: boolean;
  selectedModel: ClientModelOption | null;
}

function formatPricePerMillion(cents: number): string {
  const dollars = cents / 100;
  return dollars < 0.01 && dollars > 0 ? `$${dollars.toFixed(4)}` : `$${dollars.toFixed(2)}`;
}

function AgentChatTerminalHeaderComponent({
  agentName,
  onOpenSettings,
  modelKey,
  onModelSelect,
  models,
  modelsLoading,
  modelsError,
  onRetryModels,
  isStreaming,
  selectedModel,
}: Props) {
  const pricingLabel =
    selectedModel?.billingOwner === "user"
      ? selectedModel.billingLabel ?? "Your provider account"
      : selectedModel && !selectedModel.isFree
        ? `${formatPricePerMillion(selectedModel.pricing.inputPerMillionCents)} / ${formatPricePerMillion(selectedModel.pricing.outputPerMillionCents)} per 1M`
        : selectedModel?.isFree
          ? "Free model"
          : "—";

  return (
    <header className="ui-terminal-titlebar flex h-9 shrink-0 items-center gap-3 border-b border-[#3a3a3c] bg-[#2d2d2d] px-3 font-mono text-[11px] text-[#a1a1a6]">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="hidden truncate text-[#d1d1d6] sm:inline">
          {agentName.trim() || "Agent"} Terminal
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-hidden sm:justify-center sm:gap-3">
        <div className="ui-terminal-model-picker min-w-0 shrink">
          <AgentChatModelPicker
            models={models}
            isLoading={modelsLoading}
            isError={modelsError}
            modelKey={modelKey}
            onSelect={onModelSelect}
            onRetry={onRetryModels}
            disabled={isStreaming}
            appearance="terminal"
          />
        </div>
        <span className="hidden text-[#48484a] lg:inline" aria-hidden>
          |
        </span>
        <span className="hidden shrink-0 tabular-nums lg:inline" title="Model pricing">
          {pricingLabel}
        </span>
      </div>

      <div className="flex shrink-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Chat settings"
          onClick={onOpenSettings}
          className="size-7 text-[#a1a1a6] hover:bg-[#3a3a3c] hover:text-[#f5f5f7]"
        >
          <Settings aria-hidden className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}

export const AgentChatTerminalHeader = memo(AgentChatTerminalHeaderComponent);
