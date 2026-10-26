"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import {
  CalendarClock,
  CheckCircle2,
  CirclePlay,
  Clock3,
  GripVertical,
  History,
  Loader2,
  Pause,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { showToast } from "@/components/ui/toast-simple";
import { AgentScheduleDialog } from "@/components/dashboard/agent-schedule-dialog";
import { DashboardConfirmDeleteDialog } from "@/components/dashboard/shared/confirm-delete-dialog";
import type {
  AgentScheduleFrequency,
  AgentScheduleRow,
  AgentScheduleRunRow,
  AgentScheduleType,
  DashboardSchedulePageData,
} from "@/lib/agent-schedule/types";
import { cronExprToLabel, isOnceCronExpr } from "@/lib/agent-schedule/cron";
import { MAX_AGENT_SCHEDULES_PER_AGENT } from "@/lib/agent-schedule/constants";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import { cn } from "@/lib/utils";

const TOGGLE_COOLDOWN_MS = 2_000;

function stopRowAction(event: React.MouseEvent | React.PointerEvent) {
  event.stopPropagation();
}

type Props = {
  initialData: DashboardSchedulePageData;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TYPE_LABELS: Record<AgentScheduleType, string> = {
  prompt: "Prompt",
  report: "Report",
  trade: "Trade",
};

function statusTone(status: AgentScheduleRow["lastRunStatus"]): string {
  switch (status) {
    case "success":
      return "text-emerald-600 dark:text-emerald-400";
    case "failed":
      return "text-red-600 dark:text-red-400";
    case "skipped":
      return "text-amber-600 dark:text-amber-400";
    case "running":
      return "text-foreground";
    default:
      return "text-muted-foreground";
  }
}

function formatRunDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function EmptyState({
  onCreate,
  atLimit,
}: {
  onCreate: () => void;
  atLimit: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/40 p-10 text-center">
      <CalendarClock className="text-muted-foreground/40 mx-auto mb-3 h-8 w-8" />
      <p className="text-sm font-medium">No scheduled tasks yet</p>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-xs leading-relaxed">
        Set recurring prompts and reports for this agent. You can add up to{" "}
        {MAX_AGENT_SCHEDULES_PER_AGENT} tasks — free models don&apos;t use credits.
      </p>
      <Button className="mt-5 gap-2" onClick={onCreate} disabled={atLimit}>
        <Plus className="h-4 w-4" />
        Create your first task
      </Button>
    </div>
  );
}

export function AgentSchedulePage({ initialData }: Props) {
  const reduceMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AgentScheduleRow | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [historySchedule, setHistorySchedule] = useState<AgentScheduleRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleCooldownIds, setToggleCooldownIds] = useState<ReadonlySet<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<AgentScheduleRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const agentDbId = initialData.agentDbId;
  const apiBase = `/api/dashboard/agents/${agentDbId}/schedules`;

  const schedulesQuery = useQuery({
    queryKey: dashboardKeys.schedules(agentDbId),
    queryFn: async ({ signal }) => {
      const res = await fetch(apiBase, { signal });
      if (!res.ok) return [] as AgentScheduleRow[];
      const data = (await res.json()) as { schedules: AgentScheduleRow[] };
      return data.schedules;
    },
    initialData: initialData.schedules,
    refetchOnMount: false,
  });
  const schedules: AgentScheduleRow[] = schedulesQuery.data ?? initialData.schedules;
  const invalidateSchedules = useCallback(
    () => queryClient.invalidateQueries({ queryKey: dashboardKeys.schedules(agentDbId) }),
    [queryClient, agentDbId],
  );

  const historyScheduleId = historySchedule?.id ?? null;
  const historyQuery = useQuery({
    queryKey: dashboardKeys.scheduleRuns(agentDbId, historyScheduleId ?? ""),
    queryFn: async ({ signal }) => {
      const res = await fetch(`${apiBase}/${historyScheduleId}/runs`, { signal });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to load run history");
      }
      const data = (await res.json()) as { runs: AgentScheduleRunRow[] };
      return data.runs;
    },
    enabled: historyScheduleId != null,
  });
  const historyRuns = historyQuery.data ?? [];
  const historyLoading = historyScheduleId != null && historyQuery.isPending;

  const stats = useMemo(() => {
    const active = schedules.filter((s) => s.status === "active").length;
    const paused = schedules.filter((s) => s.status === "paused").length;
    const completed = schedules.filter((s) => s.status === "completed").length;
    const nextRun = schedules
      .filter((s) => s.status === "active")
      .map((s) => new Date(s.nextRunAt).getTime())
      .sort((a, b) => a - b)[0];
    return {
      total: schedules.length,
      active,
      paused,
      completed,
      nextRunLabel: nextRun != null ? formatRunDate(new Date(nextRun).toISOString()) : "—",
    };
  }, [schedules]);

  const modelLabelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const model of initialData.models) {
      map.set(model.modelKey, model.label);
    }
    return map;
  }, [initialData.models]);

  const atScheduleLimit = schedules.length >= MAX_AGENT_SCHEDULES_PER_AGENT;

  const openCreate = () => {
    if (atScheduleLimit) {
      showToast(
        `You can schedule up to ${MAX_AGENT_SCHEDULES_PER_AGENT} tasks per agent`,
        "error",
      );
      return;
    }
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (schedule: AgentScheduleRow) => {
    if (schedule.status === "completed") {
      showToast("Completed tasks cannot be edited", "error");
      return;
    }
    setEditing(schedule);
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      label: string;
      type: AgentScheduleType;
      modelKey: string;
      promptText: string;
      frequency: AgentScheduleFrequency;
    }) => {
      const url = editing ? `${apiBase}/${editing.id}` : apiBase;
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to save schedule");
      }
      return data;
    },
    onSuccess: async () => {
      await invalidateSchedules();
      showToast(editing ? "Schedule updated" : "Schedule created");
    },
  });
  const saveSchedule = useCallback(
    async (payload: {
      label: string;
      type: AgentScheduleType;
      modelKey: string;
      promptText: string;
      frequency: AgentScheduleFrequency;
    }) => {
      await saveMutation.mutateAsync(payload);
    },
    [saveMutation],
  );

  const toggleMutation = useMutation({
    mutationFn: async (variables: {
      id: string;
      status: "active" | "paused";
    }) => {
      const res = await fetch(`${apiBase}/${variables.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: variables.status }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to update task");
      }
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: dashboardKeys.schedules(agentDbId),
      });
      const previous = queryClient.getQueryData<AgentScheduleRow[]>(
        dashboardKeys.schedules(agentDbId),
      );
      queryClient.setQueryData<AgentScheduleRow[]>(
        dashboardKeys.schedules(agentDbId),
        (prev) =>
          prev?.map((item) =>
            item.id === variables.id ? { ...item, status: variables.status } : item,
          ),
      );
      setTogglingId(variables.id);
      return { previous };
    },
    onSuccess: (_data, variables) => {
      setToggleCooldownIds((previous) => {
        const next = new Set(previous);
        next.add(variables.id);
        return next;
      });
      window.setTimeout(() => {
        setToggleCooldownIds((previous) => {
          if (!previous.has(variables.id)) return previous;
          const next = new Set(previous);
          next.delete(variables.id);
          return next;
        });
      }, TOGGLE_COOLDOWN_MS);
      showToast(variables.status === "paused" ? "Task paused" : "Task resumed");
    },
    onError: (_err, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(dashboardKeys.schedules(agentDbId), context.previous);
      }
      showToast("Failed to update task", "error");
    },
    onSettled: () => {
      setTogglingId(null);
      void invalidateSchedules();
    },
  });

  const togglePause = useCallback(
    (schedule: AgentScheduleRow) => {
      if (schedule.status === "completed") return;
      if (toggleCooldownIds.has(schedule.id)) {
        showToast("Please wait a moment before toggling again", "error");
        return;
      }
      if (togglingId === schedule.id) return;
      const nextStatus = schedule.status === "active" ? "paused" : "active";
      toggleMutation.mutate({ id: schedule.id, status: nextStatus });
    },
    [toggleCooldownIds, togglingId, toggleMutation],
  );

  const deleteMutation = useMutation({
    mutationFn: async (targetId: string) => {
      const res = await fetch(`${apiBase}/${targetId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete task");
    },
    onMutate: async (targetId) => {
      await queryClient.cancelQueries({
        queryKey: dashboardKeys.schedules(agentDbId),
      });
      const previous = queryClient.getQueryData<AgentScheduleRow[]>(
        dashboardKeys.schedules(agentDbId),
      );
      queryClient.setQueryData<AgentScheduleRow[]>(
        dashboardKeys.schedules(agentDbId),
        (prev) => prev?.filter((item) => item.id !== targetId),
      );
      setDeleting(true);
      return { previous };
    },
    onSuccess: () => {
      showToast("Task removed");
      setDeleteTarget(null);
    },
    onError: (_err, _targetId, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(dashboardKeys.schedules(agentDbId), context.previous);
      }
      showToast("Failed to delete task", "error");
    },
    onSettled: () => {
      setDeleting(false);
      void invalidateSchedules();
    },
  });

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id);
  }, [deleteTarget, deleteMutation]);

  const openHistory = useCallback((schedule: AgentScheduleRow) => {
    setHistorySchedule(schedule);
  }, []);

  const onDragStart = (id: string) => setDraggingId(id);

  const onDragOver = (event: React.DragEvent, overId: string) => {
    event.preventDefault();
    if (!draggingId || draggingId === overId) return;
    queryClient.setQueryData<AgentScheduleRow[]>(
      dashboardKeys.schedules(agentDbId),
      (prev) => {
        if (!prev) return prev;
        const from = prev.findIndex((s) => s.id === draggingId);
        const to = prev.findIndex((s) => s.id === overId);
        if (from < 0 || to < 0) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      },
    );
  };

  const onDragEnd = async () => {
    const orderedIds = schedules.map((s) => s.id);
    setDraggingId(null);
    const res = await fetch(apiBase, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    if (!res.ok) {
      showToast("Failed to save schedule order", "error");
      await invalidateSchedules();
    }
  };

  return (
    <div className="ui-dashboard-overview ui-schedule-page mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity flex flex-wrap items-start justify-between gap-4 px-4 py-3.5 sm:px-5">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <CalendarClock className="h-5 w-5 text-muted-foreground" aria-hidden />
              Schedule
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Set recurring tasks for this agent — prompts, reports, and more. Up to{" "}
            {MAX_AGENT_SCHEDULES_PER_AGENT} per agent. Paid models use LLM credits; free
            models don&apos;t.
            </p>
          </div>
          <Button onClick={openCreate} variant="secondary" className="gap-2" disabled={atScheduleLimit}>
            <Plus className="h-4 w-4" />
            New task
          </Button>
        </div>
        <div className="ui-overview-metrics grid grid-cols-2 sm:grid-cols-4">
          <div className="ui-overview-metric px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Active
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{stats.active}</p>
          </div>
          <div className="ui-overview-metric px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Paused
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{stats.paused}</p>
          </div>
          <div className="ui-overview-metric px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Completed
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{stats.completed}</p>
          </div>
          <div className="ui-overview-metric px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Next run
            </p>
            <p className="mt-1 truncate text-sm font-semibold tabular-nums" title={stats.nextRunLabel}>
              {stats.nextRunLabel}
            </p>
          </div>
        </div>
      </div>

      <div className="ui-action-card text-xs text-muted-foreground">
        <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="leading-relaxed">
          Tasks run automatically in the background. Use pause and resume to control
          each task. Times use UTC.
        </p>
      </div>

      {schedules.length === 0 ? (
        <EmptyState onCreate={openCreate} atLimit={atScheduleLimit} />
      ) : (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header flex items-center justify-between px-5 py-4">
            <h2 className="text-sm font-semibold">Scheduled tasks</h2>
            <span className="text-xs text-muted-foreground">{stats.total} total</span>
          </div>
          <ul className="flex flex-col gap-3 px-5 py-4">
          {schedules.map((schedule) => {
            const isDragging = draggingId === schedule.id;
            const isCompleted = schedule.status === "completed";
            const isActive = schedule.status === "active";
            const isPaused = schedule.status === "paused";
            const isOnce = isOnceCronExpr(schedule.cronExpr);
            const model = initialData.models.find((m) => m.modelKey === schedule.modelKey);
            const toggleDisabled =
              togglingId === schedule.id || toggleCooldownIds.has(schedule.id);
            return (
              <motion.li
                key={schedule.id}
                layout={!reduceMotion}
                animate={{
                  scale: isDragging ? 1.01 : 1,
                }}
                transition={{ type: "spring", stiffness: 420, damping: 28 }}
                className={cn(
                  "rounded-xl border border-border/60 bg-muted/10 transition-shadow",
                  isDragging && "z-10 shadow-lg ring-2 ring-border",
                  isPaused && "opacity-80",
                  isCompleted && "border-emerald-500/25 bg-emerald-500/[0.03]",
                )}
                draggable={!isCompleted}
                onDragStart={() => onDragStart(schedule.id)}
                onDragOver={(e) => onDragOver(e, schedule.id)}
                onDragEnd={() => void onDragEnd()}
              >
                <div className="flex items-start gap-3 p-4">
                  {isCompleted ? (
                    <div
                      className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      aria-label="Completed"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground mt-1 cursor-grab active:cursor-grabbing"
                      aria-label="Drag to reorder"
                      onPointerDown={stopRowAction}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium">{schedule.label}</h2>
                      <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {TYPE_LABELS[schedule.type]}
                      </span>
                      {isCompleted ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="size-3" aria-hidden />
                          Completed
                        </span>
                      ) : isPaused ? (
                        <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          Paused
                        </span>
                      ) : (
                        <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1.5 text-sm">
                      {cronExprToLabel(schedule.cronExpr)}
                      {" · "}
                      {modelLabelByKey.get(schedule.modelKey) ?? schedule.modelKey}
                      {model?.billingOwner === "user"
                        ? " · your provider key"
                        : model?.isFree
                          ? " · free"
                          : " · paid"}
                    </p>
                    <p className="text-muted-foreground mt-2 line-clamp-2 text-xs leading-relaxed">
                      {schedule.promptText}
                    </p>
                    <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                      {!isCompleted ? (
                        <span>
                          <span className="text-foreground/70">Next:</span>{" "}
                          {formatRunDate(schedule.nextRunAt)}
                        </span>
                      ) : isOnce ? (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          Finished {schedule.lastRunAt ? formatRunDate(schedule.lastRunAt) : ""}
                        </span>
                      ) : null}
                      {schedule.lastRunStatus && !isCompleted ? (
                        <span className={statusTone(schedule.lastRunStatus)}>
                          Last: {schedule.lastRunStatus}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div
                    className="flex shrink-0 flex-wrap items-center justify-end gap-1"
                    onPointerDown={stopRowAction}
                  >
                    {!isCompleted ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={isActive ? "Pause" : "Resume"}
                        disabled={toggleDisabled}
                        onClick={() => void togglePause(schedule)}
                      >
                        {togglingId === schedule.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isActive ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <CirclePlay className="h-4 w-4" />
                        )}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="History"
                      onClick={() => void openHistory(schedule)}
                    >
                      <History className="h-4 w-4" />
                    </Button>
                    {!isCompleted ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit"
                        onClick={() => openEdit(schedule)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      onClick={() => setDeleteTarget(schedule)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </motion.li>
            );
          })}
          </ul>
        </section>
      )}

      <AgentScheduleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        models={initialData.models}
        defaultModelKey={initialData.defaultModelKey}
        schedule={editing}
        dayLabels={DAY_LABELS}
        onSave={saveSchedule}
      />

      <Dialog
        open={historySchedule != null}
        onOpenChange={(open) => {
          if (!open) setHistorySchedule(null);
        }}
      >
        <DialogContent className="ui-overview-panel max-h-[85vh] max-w-2xl overflow-hidden rounded-xl p-0">
          <DialogHeader className="ui-overview-panel-header px-5 py-4 text-left">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/30">
                <History className="size-4 text-muted-foreground" />
              </div>
              <div>
                <DialogTitle>Run history</DialogTitle>
                <DialogDescription className="text-xs">
                  {historySchedule?.label}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
            {historyLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : historyRuns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/40 p-8 text-center">
                <Sparkles className="text-muted-foreground/40 mx-auto mb-2 h-6 w-6" />
                <p className="text-muted-foreground text-sm">No runs yet.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {historyRuns.map((run) => (
                  <li key={run.id} className="ui-overview-metric rounded-lg px-3 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("font-medium capitalize", statusTone(run.status))}>
                        {run.status}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatRunDate(run.scheduledFor)}
                      </span>
                    </div>
                    {run.outputSummary ? (
                      <p className="text-muted-foreground mt-2 text-xs whitespace-pre-wrap leading-relaxed">
                        {run.outputSummary}
                      </p>
                    ) : null}
                    {run.errorMessage ? (
                      <p className="mt-2 text-xs text-red-600">{run.errorMessage}</p>
                    ) : null}
                    {run.skipReason ? (
                      <p className="mt-2 text-xs text-amber-600">{run.skipReason}</p>
                    ) : null}
                    {run.costCents != null && run.costCents > 0 ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Cost: {(run.costCents / 100).toFixed(2)} credits
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <DashboardConfirmDeleteDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete task?"
        description={
          deleteTarget
            ? `"${deleteTarget.label}" will be removed permanently. This cannot be undone.`
            : ""
        }
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
