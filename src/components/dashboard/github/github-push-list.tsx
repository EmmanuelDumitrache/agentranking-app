"use client";
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import { ChevronDown, EyeOff, Loader2, MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { groupPushesByDate, type DevProofRecentCommit } from "@/lib/devproof-public";
import { formatPortfolioRelative } from "@/components/dashboard/portfolio/portfolio-utils";
import { showToast } from "@/components/ui/toast-simple";
import { cn } from "@/lib/utils";
type PushRow = DevProofRecentCommit & { hidden?: boolean };
type Props = {
  readonly agentDbId: number;
  readonly initialPushes: PushRow[];
  readonly snapshotCapturedAt: string | null;
  readonly initialSnapshotCapturedAt: string | null;
  readonly onChanged?: () => void;
};
async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) throw new Error(`Request failed (${res.status})`);
  return JSON.parse(text) as T;
}
export function DashboardGithubPushList({
  agentDbId,
  initialPushes,
  snapshotCapturedAt,
  initialSnapshotCapturedAt,
  onChanged,
}: Props) {
  const [savingSha, setSavingSha] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [localPushes, setLocalPushes] = useState<{ agentDbId: number; rows: PushRow[] } | null>(null);
  const loadPushes = useCallback(async (signal: AbortSignal): Promise<PushRow[]> => {
    const response = await fetch(`/api/dashboard/agents/${agentDbId}/github/pushes`, { signal });
    const data = await readJson<{ pushes?: PushRow[]; error?: string }>(response);
    if (!response.ok) throw new Error(data.error ?? "Failed to load pushes");
    return data.pushes ?? [];
  }, [agentDbId]);
  const resource = useQuery({
    queryKey: dashboardKeys.githubPushes(agentDbId, snapshotCapturedAt),
    queryFn: ({ signal }) => loadPushes(signal),
    initialData:
      snapshotCapturedAt === initialSnapshotCapturedAt ? initialPushes : undefined,
    refetchOnMount: false,
  });
  const pushes = localPushes?.agentDbId === agentDbId ? localPushes.rows : resource.data ?? [];
  const loading = resource.isPending;
  async function patchPush(
    commitSha: string,
    patch: { devNote?: string | null; hidden?: boolean; clearNote?: boolean },
  ) {
    setSavingSha(commitSha);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/github/pushes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitSha, ...patch }),
      });
      const data = await readJson<{ pushes?: PushRow[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      setLocalPushes({ agentDbId, rows: data.pushes ?? [] });
      onChanged?.();
      showToast("Push updated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Update failed", "error");
    } finally {
      setSavingSha(null);
    }
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading push history…
      </div>
    );
  }
  if (resource.error) {
    return <p className="text-destructive text-xs py-4">{resource.error.message}</p>;
  }
  if (pushes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/80 px-3 py-4 text-xs text-muted-foreground">
        No pushes in the latest snapshot. Run <strong>Sync DevProof</strong> after new commits land on
        GitHub.
      </div>
    );
  }
  const visibleGroups = groupPushesByDate(pushes.filter((p) => !p.hidden));
  const hiddenCount = pushes.filter((p) => p.hidden).length;
  const firstVisibleSha = visibleGroups[0]?.pushes[0]?.sha ?? null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground">Push history</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Add dev notes for your profile. Hidden pushes stay in dashboard only.
          </p>
        </div>
        {hiddenCount > 0 ? (
          <span className="text-[10px] text-muted-foreground">{hiddenCount} hidden on profile</span>
        ) : null}
      </div>
      {visibleGroups.map((group) => (
        <div key={group.dateKey} className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group.dateLabel}
          </p>
          <ul className="space-y-2">
            {group.pushes.map((push) => (
              <PushEditorRow
                key={`${push.sha}-${push.committedAt}`}
                push={push}
                draftNote={draftNotes[push.sha] ?? ""}
                busy={savingSha === push.sha}
                defaultExpanded={push.sha === firstVisibleSha}
                onDraftChange={(value: string) =>
                  setDraftNotes((prev) => ({ ...prev, [push.sha]: value }))
                }
                onSaveNote={() =>
                  void patchPush(push.fullSha ?? push.sha, {
                    devNote: draftNotes[push.sha] ?? "",
                  })
                }
                onClearNote={() => {
                  setDraftNotes((prev) => ({ ...prev, [push.sha]: "" }));
                  void patchPush(push.fullSha ?? push.sha, { clearNote: true });
                }}
                onToggleHidden={() =>
                  void patchPush(push.fullSha ?? push.sha, { hidden: !push.hidden })
                }
              />
            ))}
          </ul>
        </div>
      ))}
      {hiddenCount > 0 ? (
        <div className="space-y-2 pt-2 border-t border-border/60">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Hidden from profile
          </p>
          <ul className="space-y-2">
            {pushes
              .filter((p) => p.hidden)
              .map((push) => (
                <li
                  key={`hidden-${push.sha}`}
                  className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">{push.message}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{push.sha}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px]"
                    disabled={savingSha === push.sha}
                    onClick={() => void patchPush(push.fullSha ?? push.sha, { hidden: false })}
                  >
                    Show on profile
                  </Button>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
function PushEditorRow({
  push,
  draftNote,
  busy,
  defaultExpanded = false,
  onDraftChange,
  onSaveNote,
  onClearNote,
  onToggleHidden,
}: {
  readonly push: PushRow;
  readonly draftNote: string;
  readonly busy: boolean;
  readonly defaultExpanded?: boolean;
  readonly onDraftChange: (value: string) => void;
  readonly onSaveNote: () => void;
  readonly onClearNote: () => void;
  readonly onToggleHidden: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const savedNote = push.devNote?.trim() ?? "";
  const dirty = draftNote.trim() !== savedNote;
  const notePreview = (dirty ? draftNote : savedNote).trim();
  return (
    <li className="rounded-lg border border-border/70 bg-card overflow-hidden">
      <div className="flex items-start gap-1 px-2 py-2">
        <button
          type="button"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse push" : "Expand push"}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform duration-200", expanded && "rotate-180")}
          />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 text-left rounded-md px-1 py-0.5 hover:bg-muted/30 transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <p className="text-xs font-medium text-foreground leading-snug line-clamp-2">{push.message}</p>
          <p className="text-[10px] text-muted-foreground mt-1 font-mono">
            {push.sha}
            {push.authorLogin ? ` · ${push.authorLogin}` : null}
            {" · "}
            {formatPortfolioRelative(new Date(push.committedAt))}
          </p>
          {!expanded && notePreview ? (
            <p className="mt-1 flex items-start gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 line-clamp-1">
              <MessageSquare className="h-3 w-3 shrink-0 mt-px" aria-hidden />
              <span>{notePreview}</span>
            </p>
          ) : null}
          {!expanded && dirty ? (
            <span className="mt-1 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
              Unsaved note
            </span>
          ) : null}
        </button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 shrink-0"
          title="Hide from public profile"
          disabled={busy}
          onClick={onToggleHidden}
        >
          <EyeOff className="h-3.5 w-3.5" />
        </Button>
      </div>
      {expanded ? (
        <div className="space-y-1.5 border-t border-border/50 px-3 pb-2.5 pt-2">
          <label
            htmlFor={`push-note-${push.sha}`}
            className="text-[10px] font-medium text-muted-foreground"
          >
            Dev note (public)
          </label>
          <textarea
            id={`push-note-${push.sha}`}
            className="w-full min-h-[56px] rounded-md border border-border bg-background px-2.5 py-2 text-xs resize-y"
            placeholder="What changed in this update? Shown on your agent profile."
            value={draftNote}
            maxLength={500}
            onChange={(e) => onDraftChange(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 text-[10px]"
              disabled={busy || !dirty}
              onClick={onSaveNote}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Save note
            </Button>
            {savedNote ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[10px]"
                disabled={busy}
                onClick={onClearNote}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Remove note
              </Button>
            ) : null}
          </div>
          {savedNote ? (
            <p className={cn("text-[10px] text-emerald-600 dark:text-emerald-400")}>
              Live on profile: {savedNote}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
