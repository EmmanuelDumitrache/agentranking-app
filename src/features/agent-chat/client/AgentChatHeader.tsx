"use client";
import { memo } from "react";
import { PanelRightClose, PanelRightOpen, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientModelOption } from "../shared/contracts";
import { AgentChatModelPicker } from "./AgentChatModelPicker";
interface Props {
  contextOpen: boolean;
  onToggleContext: () => void;
  onOpenSettings: () => void;
  modelKey: string;
  onModelSelect: (modelKey: string) => void;
  models: ClientModelOption[];
  modelsLoading: boolean;
  modelsError: boolean;
  onRetryModels: () => void;
  isStreaming: boolean;
}
function AgentChatHeaderComponent({
  contextOpen,
  onToggleContext,
  onOpenSettings,
  modelKey,
  onModelSelect,
  models,
  modelsLoading,
  modelsError,
  onRetryModels,
  isStreaming,
}: Props) {
  const ContextIcon = contextOpen ? PanelRightClose : PanelRightOpen;
  return (
    <header className="ui-chat-header grid h-12 min-w-0 shrink-0 grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-1.5 !border-b !border-[#212121] !bg-[#0f0f0f]/95 px-3 sm:gap-2 sm:px-4">
      <div aria-hidden className="min-w-0" />
      <div className="min-w-0 justify-self-center">
        <AgentChatModelPicker
          models={models}
          isLoading={modelsLoading}
          isError={modelsError}
          modelKey={modelKey}
          onSelect={onModelSelect}
          onRetry={onRetryModels}
          disabled={isStreaming}
        />
      </div>
      <div className="flex shrink-0 items-center justify-self-end gap-1.5 sm:gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Chat settings"
          onClick={onOpenSettings}
          className="rounded-lg text-neutral-500 hover:bg-[#181818] hover:text-neutral-100"
        >
          <Settings aria-hidden className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleContext}
          aria-label={contextOpen ? "Hide agent context" : "Show agent context"}
          aria-pressed={contextOpen}
          className="rounded-lg text-neutral-500 hover:bg-[#181818] hover:text-neutral-100"
        >
          <ContextIcon aria-hidden className="size-4" />
        </Button>
      </div>
    </header>
  );
}
export const AgentChatHeader = memo(AgentChatHeaderComponent);
