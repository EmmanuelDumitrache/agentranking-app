"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  CalendarClock,
  CircleDollarSign,
  FileText,
  HelpCircle,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClientModelOption } from "@/features/agent-chat/shared/contracts";
import type {
  AgentScheduleFrequency,
  AgentScheduleRow,
  AgentScheduleType,
} from "@/lib/agent-schedule/types";
import { isOnceCronExpr, parseOnceRunAt } from "@/lib/agent-schedule/cron";
import { showToast } from "@/components/ui/toast-simple";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: ClientModelOption[];
  defaultModelKey: string;
  schedule: AgentScheduleRow | null;
  dayLabels: readonly string[];
  onSave: (payload: {
    label: string;
    type: AgentScheduleType;
    modelKey: string;
    promptText: string;
    frequency: AgentScheduleFrequency;
  }) => Promise<void>;
};

type FrequencyKind = "once" | "hourly" | "daily" | "weekly";

function defaultOnceDateUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function parseScheduleToForm(cronExpr: string): {
  freqKind: FrequencyKind;
  onceDateUtc: string;
  minuteUtc: number;
  hourUtc: number;
  dayOfWeekUtc: number;
} {
  if (isOnceCronExpr(cronExpr)) {
    const runAt = parseOnceRunAt(cronExpr);
    return {
      freqKind: "once",
      onceDateUtc: runAt.toISOString().slice(0, 10),
      hourUtc: runAt.getUTCHours(),
      minuteUtc: runAt.getUTCMinutes(),
      dayOfWeekUtc: 1,
    };
  }

  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      freqKind: "daily",
      onceDateUtc: defaultOnceDateUtc(),
      minuteUtc: 0,
      hourUtc: 9,
      dayOfWeekUtc: 1,
    };
  }
  const [minute, hour, , , dayOfWeek] = parts;
  const minuteNum = Number.parseInt(minute ?? "0", 10);
  const hourNum = Number.parseInt(hour ?? "9", 10);
  const dayNum = Number.parseInt(dayOfWeek ?? "1", 10);
  if (hour === "*" || Number.isNaN(hourNum)) {
    return {
      freqKind: "hourly",
      onceDateUtc: defaultOnceDateUtc(),
      minuteUtc: minuteNum || 0,
      hourUtc: 9,
      dayOfWeekUtc: 1,
    };
  }
  if (!Number.isNaN(dayNum) && dayNum >= 0 && dayNum <= 6 && dayOfWeek !== "*") {
    return {
      freqKind: "weekly",
      onceDateUtc: defaultOnceDateUtc(),
      minuteUtc: minuteNum || 0,
      hourUtc: hourNum || 9,
      dayOfWeekUtc: dayNum,
    };
  }
  return {
    freqKind: "daily",
    onceDateUtc: defaultOnceDateUtc(),
    minuteUtc: minuteNum || 0,
    hourUtc: hourNum || 9,
    dayOfWeekUtc: 1,
  };
}

function buildFrequency(
  kind: FrequencyKind,
  onceDateUtc: string,
  minuteUtc: number,
  hourUtc: number,
  dayOfWeekUtc: number,
): AgentScheduleFrequency {
  switch (kind) {
    case "once": {
      const runAt = new Date(
        `${onceDateUtc}T${String(hourUtc).padStart(2, "0")}:${String(minuteUtc).padStart(2, "0")}:00.000Z`,
      );
      return { kind: "once", runAtUtc: runAt.toISOString() };
    }
    case "hourly":
      return { kind: "hourly", minuteUtc };
    case "daily":
      return { kind: "daily", hourUtc, minuteUtc };
    case "weekly":
      return { kind: "weekly", dayOfWeekUtc, hourUtc, minuteUtc };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
const TYPE_OPTIONS: Array<{
  value: AgentScheduleType;
  label: string;
  description: string;
  icon: typeof MessageSquare;
  disabled?: boolean;
}> = [
  {
    value: "prompt",
    label: "Prompt",
    description: "Run a single instruction",
    icon: MessageSquare,
  },
  {
    value: "report",
    label: "Report",
    description: "Structured summary output",
    icon: FileText,
  },
  {
    value: "trade",
    label: "Trade",
    description: "Coming with agent trading",
    icon: TrendingUp,
    disabled: true,
  },
];

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
              ? "border-foreground/25 bg-muted text-foreground"
              : "border-border/60 bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function buildFormState(schedule: AgentScheduleRow | null, defaultModelKey: string) {
  if (schedule) {
    const parsed = parseScheduleToForm(schedule.cronExpr);
    return {
      label: schedule.label,
      type: schedule.type,
      modelKey: schedule.modelKey,
      promptText: schedule.promptText,
      freqKind: parsed.freqKind,
      onceDateUtc: parsed.onceDateUtc,
      minuteUtc: parsed.minuteUtc,
      hourUtc: parsed.hourUtc,
      dayOfWeekUtc: parsed.dayOfWeekUtc,
    };
  }
  return {
    label: "",
    type: "prompt" as AgentScheduleType,
    modelKey: defaultModelKey,
    promptText: "",
    freqKind: "daily" as FrequencyKind,
    onceDateUtc: defaultOnceDateUtc(),
    minuteUtc: 0,
    hourUtc: 9,
    dayOfWeekUtc: 1,
  };
}

type FormProps = {
  models: ClientModelOption[];
  defaultModelKey: string;
  schedule: AgentScheduleRow | null;
  dayLabels: readonly string[];
  onSave: Props["onSave"];
  onClose: () => void;
};

function AgentScheduleForm({
  models,
  defaultModelKey,
  schedule,
  dayLabels,
  onSave,
  onClose,
}: FormProps) {
  const initial = buildFormState(schedule, defaultModelKey);
  const [label, setLabel] = useState(initial.label);
  const [type, setType] = useState<AgentScheduleType>(initial.type);
  const [modelKey, setModelKey] = useState(initial.modelKey);
  const [promptText, setPromptText] = useState(initial.promptText);
  const [freqKind, setFreqKind] = useState<FrequencyKind>(initial.freqKind);
  const [onceDateUtc, setOnceDateUtc] = useState(initial.onceDateUtc);
  const [minuteUtc, setMinuteUtc] = useState(initial.minuteUtc);
  const [hourUtc, setHourUtc] = useState(initial.hourUtc);
  const [dayOfWeekUtc, setDayOfWeekUtc] = useState(initial.dayOfWeekUtc);
  const [saving, setSaving] = useState(false);

  const clampMinute = (value: number) =>
    Number.isFinite(value) ? Math.min(59, Math.max(0, Math.round(value))) : 0;

  const clampHour = (value: number) =>
    Number.isFinite(value) ? Math.min(23, Math.max(0, Math.round(value))) : 0;

  const sortedModels = useMemo(
    () =>
      [...models].sort((a, b) => {
        if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
        return a.label.localeCompare(b.label);
      }),
    [models],
  );

  const selectedModel = useMemo(
    () => sortedModels.find((model) => model.modelKey === modelKey) ?? null,
    [modelKey, sortedModels],
  );

  const submit = async () => {
    const trimmedLabel = label.trim();
    const trimmedPrompt = promptText.trim();

    if (!trimmedLabel) {
      showToast("Add a label for this schedule", "error");
      return;
    }
    if (!trimmedPrompt) {
      showToast("Add instructions for the agent to run", "error");
      return;
    }
    if (!modelKey) {
      showToast("Select a model", "error");
      return;
    }

    const safeMinute = clampMinute(minuteUtc);
    const safeHour = clampHour(hourUtc);
    if (safeMinute !== minuteUtc) setMinuteUtc(safeMinute);
    if (safeHour !== hourUtc) setHourUtc(safeHour);

    if (freqKind === "once") {
      const runAt = new Date(
        `${onceDateUtc}T${String(safeHour).padStart(2, "0")}:${String(safeMinute).padStart(2, "0")}:00.000Z`,
      );
      if (Number.isNaN(runAt.getTime())) {
        showToast("Pick a valid date and time", "error");
        return;
      }
      if (runAt.getTime() <= Date.now()) {
        showToast("One-time tasks must be scheduled in the future", "error");
        return;
      }
    }

    setSaving(true);
    try {
      await onSave({
        label: trimmedLabel,
        type,
        modelKey,
        promptText: trimmedPrompt,
        frequency: buildFrequency(
          freqKind,
          onceDateUtc,
          safeMinute,
          safeHour,
          dayOfWeekUtc,
        ),
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  const saveLabel = schedule ? "Save changes" : "Create task";

  return (
    <>
      <div className="max-h-[calc(92vh-9.5rem)] space-y-5 overflow-y-auto px-5 py-4">
        {selectedModel ? (
          <div
            className={cn(
              "flex items-start gap-3 rounded-xl border px-3 py-3 text-sm",
              selectedModel.isFree
                ? "border-border/60 bg-muted/30 text-foreground"
                : "border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200",
            )}
          >
            <CircleDollarSign className="mt-0.5 size-4 shrink-0" />
            <p className="text-xs leading-relaxed">
              {selectedModel.isFree
                ? "This schedule uses a free model — no LLM credits required."
                : "Paid model selected. Each run deducts from your LLM credit balance."}
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <SectionLabel>Label</SectionLabel>
            <Input
              id="schedule-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Weekly market report"
            />
          </div>
          <div>
            <SectionLabel>Model</SectionLabel>
            <Select value={modelKey} onValueChange={setModelKey}>
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {sortedModels.map((model) => (
                  <SelectItem key={model.modelKey} value={model.modelKey}>
                    {model.label}
                    {model.isFree ? " · free" : " · paid"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <SectionLabel>Type</SectionLabel>
          <div className="grid gap-2 sm:grid-cols-3">
            {TYPE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = type === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => setType(option.value)}
                  className={cn(
                    "rounded-xl border px-3 py-3 text-left transition-colors",
                    option.disabled && "cursor-not-allowed opacity-50",
                    selected
                      ? "border-foreground/25 bg-muted"
                      : "border-border/60 bg-background hover:bg-muted/40",
                  )}
                >
                  <Icon className="mb-2 size-4 text-muted-foreground" />
                  <p className="text-sm font-medium">{option.label}</p>
                  <p className="text-muted-foreground mt-0.5 text-[11px] leading-relaxed">
                    {option.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <SectionLabel hint="Times are in UTC">How often</SectionLabel>
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <SegmentedControl
              value={freqKind}
              options={[
                { value: "once", label: "Once" },
                { value: "hourly", label: "Hourly" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
              ]}
              onChange={setFreqKind}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {freqKind === "once" ? (
                <div className="col-span-2 grid gap-2 sm:col-span-3">
                  <Label className="text-xs text-muted-foreground">Date</Label>
                  <Input
                    type="date"
                    value={onceDateUtc}
                    onChange={(e) => setOnceDateUtc(e.target.value)}
                  />
                </div>
              ) : null}
              {freqKind !== "hourly" ? (
                <div className="grid gap-2">
                  <Label className="text-xs text-muted-foreground">Hour</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={hourUtc}
                    onChange={(e) => setHourUtc(Number(e.target.value))}
                    onBlur={() => setHourUtc((value) => clampHour(value))}
                  />
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">Minute</Label>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={minuteUtc}
                  onChange={(e) => setMinuteUtc(Number(e.target.value))}
                  onBlur={() => setMinuteUtc((value) => clampMinute(value))}
                />
              </div>
              {freqKind === "weekly" ? (
                <div className="col-span-2 grid gap-2 sm:col-span-1">
                  <Label className="text-xs text-muted-foreground">Day</Label>
                  <Select
                    value={String(dayOfWeekUtc)}
                    onValueChange={(v) => setDayOfWeekUtc(Number.parseInt(v, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {dayLabels.map((day, index) => (
                        <SelectItem key={day} value={String(index)}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div>
          <SectionLabel>Instructions</SectionLabel>
          <Textarea
            id="schedule-prompt"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={4}
            placeholder="Summarize SOL price action and my agent wallet holdings…"
            className="min-h-[96px] resize-y"
          />
        </div>
      </div>

      <DialogFooter className="border-t border-border/60 px-5 py-4">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

export function AgentScheduleDialog({
  open,
  onOpenChange,
  models,
  defaultModelKey,
  schedule,
  dayLabels,
  onSave,
}: Props) {
  const title = schedule ? "Edit task" : "New task";
  const formKey = schedule?.id ?? `new:${defaultModelKey}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ui-schedule-dialog ui-overview-panel max-h-[92vh] overflow-hidden rounded-xl p-0 sm:max-w-2xl">
        <DialogHeader className="ui-overview-panel-header px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground">
              <CalendarClock className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1 text-left">
              <DialogTitle className="text-lg">{title}</DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                Set a one-time or repeating task for your agent. Free models run at no
                cost; paid models use your LLM credit balance.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {open ? (
          <AgentScheduleForm
            key={formKey}
            models={models}
            defaultModelKey={defaultModelKey}
            schedule={schedule}
            dayLabels={dayLabels}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
