"use client";
import {
  memo,
  useCallback,
  useDeferredValue,
  useMemo,
} from "react";
import {
  AlertCircle,
  BrainCircuit,
  Check,
  ChevronsUpDown,
  Globe2,
  ImageIcon,
  Loader2,
  Paperclip,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getOrInsertComputed } from "@/lib/map-upsert";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSourceDraft } from "@/hooks/use-source-draft";
import type { ClientModelOption } from "../shared/contracts";
interface Props {
  models: ClientModelOption[];
  isLoading: boolean;
  isError: boolean;
  modelKey: string;
  onSelect: (modelKey: string) => void;
  onRetry?: () => void;
  disabled?: boolean;
  appearance?: "default" | "terminal";
}
export const AGENT_CHAT_MODEL_PICKER_TRIGGER_ID =
  "agent-chat-model-picker-trigger";
type ProviderFilter = "all" | ClientModelOption["provider"];
type IndexedModel = {
  model: ClientModelOption;
  searchValue: string;
};
const MAX_RENDERED_MODELS = 120;
const TRIGGER_CLASS_NAME =
  "ui-chat-model-picker-trigger h-8 min-h-8 max-h-8 w-auto min-w-0 max-w-[min(100%,14rem)] items-center justify-between gap-1.5 rounded-lg border-[#212121] bg-[#181818] px-2.5 text-sm font-normal text-neutral-200 shadow-none hover:border-neutral-700 hover:bg-[#212121]";
const TERMINAL_TRIGGER_CLASS_NAME =
  "h-auto min-h-0 max-h-none w-auto min-w-0 max-w-[min(55vw,16rem)] items-center justify-start gap-1 rounded-none border-0 bg-transparent p-0 font-mono text-[11px] font-normal text-[#d1d1d6] shadow-none hover:bg-transparent hover:text-[#f5f5f7] hover:underline";
function capabilityLabels(model: ClientModelOption): string[] {
  return [
    model.capabilities.tools ? "Tools" : "",
    model.capabilities.reasoning ? "Reasoning" : "",
    model.capabilities.images ? "Vision" : "",
    model.capabilities.attachments ? "Attachments" : "",
    model.capabilities.webSearch ? "Web search" : "",
  ].filter(Boolean);
}
function availabilityLabel(model: ClientModelOption): string | null {
  if (model.availability === "misconfigured") return "Needs setup";
  if (model.availability === "temporarily_unavailable") return "Unavailable";
  return null;
}
function formatPrice(centsPerMillion: number): string {
  const dollars = centsPerMillion / 100;
  return dollars < 0.01 && dollars > 0
    ? `$${dollars.toFixed(4)}`
    : `$${dollars.toFixed(2)}`;
}
function modelSearchValue(model: ClientModelOption): string {
  return [
    model.label,
    model.providerLabel,
    model.modelKey,
    model.description,
    capabilityLabels(model).join(" "),
    model.billingOwner === "user"
      ? `${model.billingLabel ?? "your provider key"} byok`
      : model.isFree
        ? "free"
        : "paid",
    model.isDefault ? "default" : "",
    availabilityLabel(model) ?? "available",
  ]
    .join(" ")
    .toLocaleLowerCase();
}
function compareModels(
  left: ClientModelOption,
  right: ClientModelOption,
): number {
  if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
  if (left.availability !== right.availability) {
    if (left.availability === "available") return -1;
    if (right.availability === "available") return 1;
  }
  const billingRank = (model: ClientModelOption) =>
    model.isFree ? 0 : model.billingOwner === "user" ? 1 : 2;
  const leftBillingRank = billingRank(left);
  const rightBillingRank = billingRank(right);
  if (leftBillingRank !== rightBillingRank) return leftBillingRank - rightBillingRank;
  return left.label.localeCompare(right.label);
}
function CapabilityIcons({ model }: { model: ClientModelOption }) {
  const labels = capabilityLabels(model);
  if (labels.length === 0) return null;
  return (
    <div
      className="flex shrink-0 items-center gap-1 text-muted-foreground"
      aria-hidden
      title={labels.join(", ")}
    >
      {model.capabilities.tools && <Wrench className="size-3" />}
      {model.capabilities.reasoning && <BrainCircuit className="size-3" />}
      {model.capabilities.images && <ImageIcon className="size-3" />}
      {model.capabilities.attachments && <Paperclip className="size-3" />}
      {model.capabilities.webSearch && <Globe2 className="size-3" />}
    </div>
  );
}
const ModelOption = memo(function ModelOption({
  model,
  selected,
  onSelect,
}: {
  model: ClientModelOption;
  selected: boolean;
  onSelect: (modelKey: string) => void;
}) {
  const unavailableLabel = availabilityLabel(model);
  const capabilityText = capabilityLabels(model).join(", ");
  const priceLabel =
    model.billingOwner === "user"
      ? model.billingLabel ?? "Your provider account"
      : model.isFree
        ? "Free"
        : `${formatPrice(model.pricing.inputPerMillionCents)} input · ${formatPrice(model.pricing.outputPerMillionCents)} output per 1M tokens`;
  const accessibleLabel = [
    model.label,
    model.providerLabel,
    model.description,
    capabilityText ? `Capabilities: ${capabilityText}` : "",
    priceLabel,
    unavailableLabel ?? "Available",
    selected ? "Selected" : "",
  ]
    .filter(Boolean)
    .join(". ");
  return (
    <CommandItem
      value={model.modelKey}
      aria-label={accessibleLabel}
      aria-disabled={model.availability !== "available"}
      onSelect={() => {
        if (model.availability === "available") onSelect(model.modelKey);
      }}
      className="items-start py-2.5 text-neutral-200 data-[selected=true]:bg-[#212121] data-[selected=true]:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
    >
      <Check
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{model.label}</span>
          {model.isDefault && (
            <span className="shrink-0 rounded border border-[#212121] bg-[#181818] px-1 text-[10px] font-medium text-neutral-300">
              Default
            </span>
          )}
          {model.billingOwner === "user" ? (
            <span className="shrink-0 rounded border border-[#212121] bg-[#181818] px-1 text-[10px] font-medium text-neutral-300">
              Your key
            </span>
          ) : model.isFree ? (
            <span className="shrink-0 rounded border border-[#212121] bg-[#181818] px-1 text-[10px] font-medium text-neutral-300">
              Free
            </span>
          ) : null}
          {unavailableLabel && (
            <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">
              {unavailableLabel}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{model.description}</span>
          {model.billingOwner === "user" ? (
            <>
              <span aria-hidden className="shrink-0">·</span>
              <span className="hidden shrink-0 md:inline">
                {model.billingLabel ?? "Your provider account"}
              </span>
            </>
          ) : !model.isFree ? (
            <>
              <span aria-hidden className="shrink-0">
                ·
              </span>
              <span className="hidden shrink-0 tabular-nums md:inline">
                {formatPrice(model.pricing.inputPerMillionCents)} in ·{" "}
                {formatPrice(model.pricing.outputPerMillionCents)} out / 1M
              </span>
            </>
          ) : null}
        </div>
      </div>
      <CapabilityIcons model={model} />
    </CommandItem>
  );
});
function ModelPickerStatus({
  kind,
  onRetry,
  appearance = "default",
}: {
  kind: "loading" | "error";
  onRetry?: () => void;
  appearance?: "default" | "terminal";
}) {
  const isLoading = kind === "loading";
  const triggerClassName =
    appearance === "terminal" ? TERMINAL_TRIGGER_CLASS_NAME : TRIGGER_CLASS_NAME;
  return (
    <Button
      type="button"
      variant={appearance === "terminal" ? "ghost" : "outline"}
      size="sm"
      disabled={isLoading || !onRetry}
      onClick={isLoading ? undefined : onRetry}
      aria-label={
        isLoading
          ? "Loading models"
          : "Models unavailable. Retry loading models"
      }
      title={!isLoading && onRetry ? "Retry loading models" : undefined}
      className={triggerClassName}
    >
      <span className="min-w-0 truncate">
        {isLoading ? "Loading models…" : "Models unavailable"}
      </span>
      {isLoading ? (
        <Loader2
          aria-hidden
          className="ml-auto size-3.5 animate-spin motion-reduce:animate-none"
        />
      ) : onRetry ? (
        <RefreshCw aria-hidden className="ml-auto size-3.5 text-amber-500" />
      ) : (
        <AlertCircle aria-hidden className="ml-auto size-3.5 text-amber-500" />
      )}
    </Button>
  );
}
export function AgentChatModelPicker({
  models,
  isLoading,
  isError,
  modelKey,
  onSelect,
  onRetry,
  disabled = false,
  appearance = "default",
}: Props) {
  const stateKey = disabled ? "disabled" : "enabled";
  const [open, setOpen] = useSourceDraft(stateKey, false);
  const [search, setSearch] = useSourceDraft(stateKey, "");
  const providerKey = `${stateKey}:${models.map((model) => model.provider).join(",")}`;
  const [providerFilter, setProviderFilter] = useSourceDraft<ProviderFilter>(providerKey, "all");
  const deferredSearch = useDeferredValue(search);
  const selectedModel = useMemo(
    () => models.find((model) => model.modelKey === modelKey),
    [modelKey, models],
  );
  const indexedModels = useMemo<IndexedModel[]>(
    () =>
      models.map((model) => ({
        model,
        searchValue: modelSearchValue(model),
      })),
    [models],
  );
  const queryTerms = useMemo(
    () =>
      deferredSearch.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),
    [deferredSearch],
  );
  const textMatchingModels = useMemo(
    () =>
      indexedModels
        .filter(({ searchValue }) =>
          queryTerms.every((term) => searchValue.includes(term)),
        )
        .map(({ model }) => model),
    [indexedModels, queryTerms],
  );
  const providers = useMemo(() => {
    const labels = new Map<ClientModelOption["provider"], string>();
    const counts = new Map<ClientModelOption["provider"], number>();
    for (const model of models) labels.set(model.provider, model.providerLabel);
    for (const model of textMatchingModels) {
      counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
    }
    return [...labels.entries()].map(([provider, label]) => ({
      provider,
      label,
      count: counts.get(provider) ?? 0,
    }));
  }, [models, textMatchingModels]);
  const matchingModels = useMemo(
    () =>
      textMatchingModels
        .filter(
          (model) =>
            providerFilter === "all" || model.provider === providerFilter,
        )
        .sort((left, right) => {
          if (left.modelKey === modelKey) return -1;
          if (right.modelKey === modelKey) return 1;
          return compareModels(left, right);
        }),
    [modelKey, providerFilter, textMatchingModels],
  );
  const visibleModels = useMemo(() => {
    if (matchingModels.length <= MAX_RENDERED_MODELS) return matchingModels;
    const visible = matchingModels.slice(0, MAX_RENDERED_MODELS);
    const selected = matchingModels.find(
      (model) => model.modelKey === modelKey,
    );
    if (selected && !visible.some((model) => model.modelKey === modelKey)) {
      visible[visible.length - 1] = selected;
    }
    return visible;
  }, [matchingModels, modelKey]);
  const groupedModels = useMemo(() => {
    const groups = new Map<string, ClientModelOption[]>();
    for (const model of visibleModels) {
      getOrInsertComputed(groups, model.providerLabel, () => []).push(model);
    }
    return [...groups.entries()];
  }, [visibleModels]);
  const hiddenMatchCount = matchingModels.length - visibleModels.length;
  const hasMisconfiguredMatches = matchingModels.some(
    (model) => model.availability === "misconfigured",
  );
  const hasTemporarilyUnavailableMatches = matchingModels.some(
    (model) => model.availability === "temporarily_unavailable",
  );
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && disabled) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch("");
      setProviderFilter("all");
    }
  };
  const clearFilters = () => {
    setSearch("");
    setProviderFilter("all");
  };
  const handleSelectModel = useCallback(
    (selectedModelKey: string) => {
      if (disabled) return;
      onSelect(selectedModelKey);
      setOpen(false);
      setSearch("");
      setProviderFilter("all");
    },
    [disabled, onSelect, setOpen, setProviderFilter, setSearch],
  );
  if (isLoading) return <ModelPickerStatus kind="loading" appearance={appearance} />;
  if (isError || models.length === 0) {
    return <ModelPickerStatus kind="error" onRetry={onRetry} appearance={appearance} />;
  }
  const triggerClassName =
    appearance === "terminal" ? TERMINAL_TRIGGER_CLASS_NAME : TRIGGER_CLASS_NAME;
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={AGENT_CHAT_MODEL_PICKER_TRIGGER_ID}
          type="button"
          variant={appearance === "terminal" ? "ghost" : "outline"}
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={
            disabled
              ? `Current model: ${selectedModel?.label ?? modelKey}. Model selection is unavailable while a response is running.`
              : `Select model. Current model: ${selectedModel?.label ?? modelKey}`
          }
          disabled={disabled}
          title={
            disabled
              ? "Stop the current response before changing models"
              : undefined
          }
          className={triggerClassName}
        >
          <span className="min-w-0 truncate">
            {selectedModel?.label ?? modelKey}
          </span>
          <ChevronsUpDown
            aria-hidden
            className="ml-auto size-3.5 shrink-0 opacity-60"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          "w-[calc(100vw-1rem)] p-0 sm:w-[560px]",
          appearance !== "terminal" &&
            "ui-chat-model-picker border-[#212121] bg-[#181818] text-neutral-100 shadow-2xl [&_[data-slot=command-input-wrapper]]:border-[#212121]",
        )}
        onOpenAutoFocus={(event: Event) => {
          if (
            typeof window !== "undefined" &&
            window.matchMedia("(max-width: 639px) and (pointer: coarse)")
              .matches
          ) {
            event.preventDefault();
          }
        }}
      >
        <Command
          shouldFilter={false}
          className={cn(appearance !== "terminal" && "bg-[#181818]")}
        >
          <CommandInput
            value={search}
            onValueChange={setSearch}
            aria-label="Search models"
            placeholder="Search models, providers, capabilities, free…"
          />
          <div
            className="flex gap-1 overflow-x-auto border-b border-[#212121] p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
            aria-label="Filter models by provider"
          >
            <Button
              type="button"
              variant={providerFilter === "all" ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={providerFilter === "all"}
              onClick={() => setProviderFilter("all")}
              className="rounded-full border border-[#212121] bg-[#181818] text-neutral-400 hover:bg-[#212121] hover:text-neutral-100 aria-pressed:bg-[#212121] aria-pressed:text-neutral-100"
            >
              All
              <span className="tabular-nums text-[10px] text-muted-foreground">
                {textMatchingModels.length}
              </span>
            </Button>
            {providers.map(({ provider, label, count }) => (
              <Button
                key={provider}
                type="button"
                variant={providerFilter === provider ? "secondary" : "ghost"}
                size="xs"
                aria-pressed={providerFilter === provider}
                disabled={count === 0 && providerFilter !== provider}
                onClick={() => setProviderFilter(provider)}
                className="rounded-full border border-[#212121] bg-[#181818] text-neutral-400 hover:bg-[#212121] hover:text-neutral-100 aria-pressed:bg-[#212121] aria-pressed:text-neutral-100"
              >
                {label}
                <span className="tabular-nums text-[10px] text-muted-foreground">
                  {count}
                </span>
              </Button>
            ))}
          </div>
          <CommandList className="max-h-[min(60dvh,440px)] scroll-py-2">
            <CommandEmpty>
              <div className="flex flex-col items-center gap-2 px-4">
                <p>
                  {search.trim()
                    ? `No models match “${search.trim()}”.`
                    : "No models are available for this provider."}
                </p>
                {(search.trim() || providerFilter !== "all") && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            </CommandEmpty>
            {groupedModels.map(([providerLabel, providerModels]) => (
              <CommandGroup
                key={providerLabel}
                heading={providerLabel}
                className="[&_[cmdk-group-heading]]:sticky [&_[cmdk-group-heading]]:top-0 [&_[cmdk-group-heading]]:z-10 [&_[cmdk-group-heading]]:bg-[#181818]/95 [&_[cmdk-group-heading]]:text-neutral-500 [&_[cmdk-group-heading]]:backdrop-blur"
              >
                {providerModels.map((model) => (
                  <ModelOption
                    key={model.modelKey}
                    model={model}
                    selected={model.modelKey === modelKey}
                    onSelect={handleSelectModel}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div
            className="flex min-h-8 items-center justify-between gap-3 border-t border-[#212121] px-3 py-2 text-[11px] text-neutral-500"
            role="status"
            aria-live="polite"
          >
            <span>
              {hiddenMatchCount > 0
                ? `Showing ${visibleModels.length} of ${matchingModels.length} matches. Refine the search to narrow the list.`
                : `${matchingModels.length} ${matchingModels.length === 1 ? "model" : "models"}`}
            </span>
            {(hasMisconfiguredMatches || hasTemporarilyUnavailableMatches) && (
              <span className="hidden shrink-0 text-right sm:inline">
                {hasMisconfiguredMatches &&
                  "Needs setup = credentials required"}
                {hasMisconfiguredMatches &&
                  hasTemporarilyUnavailableMatches &&
                  " · "}
                {hasTemporarilyUnavailableMatches &&
                  "Unavailable = temporarily offline"}
              </span>
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
