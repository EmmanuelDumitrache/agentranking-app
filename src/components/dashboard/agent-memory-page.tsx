"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Brain,
  Check,
  Loader2,
  Plus,
  Pin,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showToast } from "@/components/ui/toast-simple";
import type {
  AgentMemoryFactKind,
  AgentMemoryFactRecord,
  AgentMemoryPageData,
  AgentMemorySettingsRecord,
} from "@/features/agent-memory/shared/types";
import { AGENT_MEMORY_FACT_KINDS } from "@/features/agent-memory/shared/types";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import { cn } from "@/lib/utils";
const KIND_LABELS: Record<AgentMemoryFactKind, string> = {
  preference: "Preference",
  profile: "Profile",
  constraint: "Constraint",
  avoid: "Avoid",
};
function KindPill({ kind }: { readonly kind: AgentMemoryFactKind }) {
  return (
    <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {KIND_LABELS[kind]}
    </span>
  );
}
function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (next: boolean) => void;
}) {
  return (
    <label
      aria-label={label}
      className="ui-memory-toggle ui-overview-metric flex items-center justify-between gap-4 px-4 py-3"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        className="ui-memory-switch shrink-0"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
function EmptyState() {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-border/40 p-10 text-center">
      <Sparkles className="text-muted-foreground/40 mx-auto mb-3 h-8 w-8" />
      <p className="text-sm font-medium">Nothing learned yet</p>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-xs leading-relaxed">
        Chat with this agent and durable preferences show up here. You can also add
        memories manually below.
      </p>
    </div>
  );
}
function formatMemoryTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function FactRow({
  fact,
  busy,
  onApprove,
  onReject,
  onArchive,
  onTogglePinned,
}: {
  readonly fact: AgentMemoryFactRecord;
  readonly busy: boolean;
  readonly onApprove?: () => void;
  readonly onReject?: () => void;
  readonly onArchive?: () => void;
  readonly onTogglePinned?: () => void;
}) {
  return (
    <div className="ui-memory-fact rounded-lg border border-border/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <KindPill kind={fact.kind} />
            {fact.status === "pending" ? (
              <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                Pending
              </span>
            ) : null}
            {fact.pinned ? (
              <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground">
                Pinned
              </span>
            ) : null}
          </div>
          <p className="text-sm leading-relaxed">{fact.content}</p>
          <p className="text-muted-foreground mt-2 text-[11px]" suppressHydrationWarning>
            {formatMemoryTimestamp(fact.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onTogglePinned ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              aria-label={fact.pinned ? "Unpin memory" : "Pin memory"}
              aria-pressed={fact.pinned}
              title={fact.pinned ? "Unpin memory" : "Pin memory"}
              onClick={onTogglePinned}
            >
              <Pin className={cn("h-3.5 w-3.5", fact.pinned && "fill-current")} />
            </Button>
          ) : null}
          {onApprove ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onApprove}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onReject ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onReject}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onArchive ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onArchive}
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
function memoryErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
export function AgentMemoryPage({
  agentDbId,
  initialData,
}: {
  readonly agentDbId: number;
  readonly initialData: AgentMemoryPageData;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: dashboardKeys.memory(agentDbId),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/memory`, {
        signal,
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        throw new Error(memoryErrorMessage(json, "Failed to load memory"));
      }
      return json as AgentMemoryPageData;
    },
    initialData,
    refetchOnMount: false,
  });
  const data = query.data ?? initialData;
  const [newKind, setNewKind] = useState<AgentMemoryFactKind>("preference");
  const [newContent, setNewContent] = useState("");

  const settingsMutation = useMutation({
    mutationFn: async (patch: Partial<AgentMemorySettingsRecord>) => {
      const res = await fetch(
        `/api/dashboard/agents/${agentDbId}/memory/settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const json = (await res.json()) as {
        settings?: AgentMemorySettingsRecord;
        error?: unknown;
      };
      if (!res.ok || !json.settings) {
        throw new Error(memoryErrorMessage(json, "Could not update settings"));
      }
      return json.settings;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData<AgentMemoryPageData>(
        dashboardKeys.memory(agentDbId),
        (old) => (old ? { ...old, settings } : old),
      );
      showToast("Memory settings updated", "success");
    },
    onError: (error) => {
      showToast(
        error instanceof Error ? error.message : "Could not update settings",
        "error",
      );
    },
  });

  const addFactMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: newKind, content: newContent.trim() }),
      });
      const json = (await res.json()) as {
        created?: boolean;
        revived?: boolean;
        error?: unknown;
      };
      if (!res.ok) {
        throw new Error(memoryErrorMessage(json, "Could not add memory"));
      }
      return json;
    },
    onSuccess: (json) => {
      setNewContent("");
      const message = json.created
        ? "Memory added"
        : json.revived
          ? "Memory restored"
          : "Memory already exists";
      showToast(message, "success");
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.memory(agentDbId),
      });
    },
    onError: (error) => {
      showToast(
        error instanceof Error ? error.message : "Could not add memory",
        "error",
      );
    },
  });

  const updateFactMutation = useMutation({
    mutationFn: async ({
      factId,
      patch,
    }: {
      factId: string;
      patch: { status?: "active" | "rejected" | "archived"; pinned?: boolean };
    }) => {
      const res = await fetch(
        `/api/dashboard/agents/${agentDbId}/memory/facts/${factId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const json: unknown = await res.json();
      if (!res.ok) {
        throw new Error(memoryErrorMessage(json, "Could not update memory"));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.memory(agentDbId),
      });
    },
    onError: (error) => {
      showToast(
        error instanceof Error ? error.message : "Could not update memory",
        "error",
      );
    },
  });

  const busy =
    settingsMutation.isPending ||
    addFactMutation.isPending ||
    updateFactMutation.isPending;
  const loading = query.isFetching;
  const settings = data.settings;
  const activeFacts = data.facts.active;
  const pendingFacts = data.facts.pending;
  return (
    <div className="ui-dashboard-overview ui-memory-page mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-xl font-semibold tracking-tight">Memory</h1>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  settings.enabled
                    ? "border-border bg-muted text-foreground"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {settings.enabled ? "Active" : "Off"}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              Everything this agent has learned from how you use it.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={loading || busy}
            onClick={() => void query.refetch()}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
        <div className="ui-overview-metrics grid sm:grid-cols-2">
          <ToggleRow
            label="Learn from chat"
            description="Extract durable preferences after each completed chat turn."
            checked={settings.enabled}
            disabled={busy}
            onChange={(enabled) => settingsMutation.mutate({ enabled })}
          />
          <ToggleRow
            label="Require approval"
            description="New extracted memories stay pending until you approve them."
            checked={settings.requireApproval}
            disabled={busy || !settings.enabled}
            onChange={(requireApproval) =>
              settingsMutation.mutate({ requireApproval })
            }
          />
        </div>
        {data.learnedToday > 0 ? (
          <p className="border-t border-border px-5 py-2 text-xs text-muted-foreground">
            {data.learnedToday} learned today
          </p>
        ) : null}
      </div>
      {pendingFacts.length > 0 ? (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">Pending approval</h2>
          </div>
          <div className="space-y-2 px-5 py-4">
            {pendingFacts.map((fact) => (
              <FactRow
                key={fact.id}
                fact={fact}
                busy={busy}
                onTogglePinned={() =>
                  updateFactMutation.mutate({
                    factId: fact.id,
                    patch: { pinned: !fact.pinned },
                  })
                }
                onApprove={() =>
                  updateFactMutation.mutate({ factId: fact.id, patch: { status: "active" } })
                }
                onReject={() =>
                  updateFactMutation.mutate({ factId: fact.id, patch: { status: "rejected" } })
                }
              />
            ))}
          </div>
        </section>
      ) : null}
      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-semibold">Active memories</h2>
        </div>
        <div className="px-5 py-4">
          {activeFacts.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-2">
              {activeFacts.map((fact) => (
                <FactRow
                  key={fact.id}
                  fact={fact}
                  busy={busy}
                  onTogglePinned={() =>
                    updateFactMutation.mutate({
                      factId: fact.id,
                      patch: { pinned: !fact.pinned },
                    })
                  }
                  onArchive={() =>
                    updateFactMutation.mutate({ factId: fact.id, patch: { status: "archived" } })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </section>
      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-semibold">Add memory manually</h2>
        </div>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="memory-kind">Type</Label>
            <Select
              value={newKind}
              onValueChange={(value) => setNewKind(value as AgentMemoryFactKind)}
            >
              <SelectTrigger id="memory-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_MEMORY_FACT_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="memory-content">Memory</Label>
            <Input
              id="memory-content"
              value={newContent}
              maxLength={500}
              placeholder="e.g. Always answer in bullet points"
              onChange={(event) => setNewContent(event.target.value)}
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={busy || !newContent.trim()}
              onClick={() => addFactMutation.mutate()}
            >
              <Plus className="h-4 w-4" />
              Add memory
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
