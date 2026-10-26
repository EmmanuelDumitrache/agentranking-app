"use client";
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import { GithubLogo } from "@/components/shared/brand-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DashboardStatusBadge } from "@/components/dashboard/shared/status-badge";
import {
  buildAgentGithubDisplay,
  type AgentGithubDisplay,
  type DashboardGithubConnectionDto,
  type DashboardGithubDataDto,
  type DashboardGithubSnapshotDto,
} from "@/lib/dashboard/agent-github";
import type { DevProofRecentCommit } from "@/lib/devproof-public";
import { normalizeGithubRepoFullName } from "@/lib/dashboard/github-repo-parse";
import { formatPortfolioRelative } from "@/components/dashboard/portfolio/portfolio-utils";
import { showToast } from "@/components/ui/toast-simple";
import { DashboardGithubPushList } from "@/components/dashboard/github/github-push-list";
const DEFAULT_GITHUB_INSTALL_URL =
  "https://github.com/apps/agentranking-devproof/installations/new";
async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      res.ok ? "Empty response from server" : `Request failed (${res.status})`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid server response (${res.status})`);
  }
}
type GithubConnection = DashboardGithubConnectionDto;
type GithubSnapshot = DashboardGithubSnapshotDto;
type Props = {
  readonly agentDbId: number;
  readonly isPremiumVerified?: boolean;
  readonly devProofActive?: boolean;
  readonly initialData: DashboardGithubDataDto;
  readonly initialPushes: DevProofRecentCommit[];
  readonly onUpdated: () => void;
};
export function DashboardGithubPanel({
  agentDbId,
  isPremiumVerified = true,
  devProofActive = false,
  initialData,
  initialPushes,
  onUpdated,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [localData, setLocalData] = useState<{
    agentDbId: number;
    connection: GithubConnection | null;
    snapshot: GithubSnapshot | null;
    installUrl: string | null;
  } | null>(null);
  const loadGithub = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`/api/dashboard/agents/${agentDbId}/github`, { signal });
    const data = await readJsonResponse<{
      connection?: GithubConnection | null;
      snapshots?: GithubSnapshot[];
      error?: string;
    }>(response);
    if (!response.ok) throw new Error(data.error ?? "Failed to load GitHub data");
    return {
      connection: data.connection ?? null,
      snapshot: data.snapshots?.[0] ?? null,
      installUrl: data.connection?.status === "pending" ? DEFAULT_GITHUB_INSTALL_URL : null,
    };
  }, [agentDbId]);
  const seededData = {
    connection: initialData.connection,
    snapshot: initialData.snapshots[0] ?? null,
    installUrl:
      initialData.connection?.status === "pending" ? DEFAULT_GITHUB_INSTALL_URL : null,
  };
  const resource = useQuery({
    queryKey: dashboardKeys.github(agentDbId),
    queryFn: ({ signal }) => loadGithub(signal),
    initialData: seededData,
    refetchOnMount: false,
  });
  function refreshGithub() {
    setLocalData(null);
    void resource.refetch();
  }
  const loaded = localData?.agentDbId === agentDbId ? localData : resource.data;
  const connection = loaded?.connection ?? null;
  const snapshot = loaded?.snapshot ?? null;
  const [repo, setRepo] = useSourceDraft(
    `${agentDbId}:${connection?.id ?? "none"}:${connection?.repoFullName ?? ""}`,
    connection?.repoFullName
      ? normalizeGithubRepoFullName(connection.repoFullName) ?? connection.repoFullName
      : "",
  );
  const [installUrlOverride, setInstallUrlOverride] = useState<{
    agentDbId: number;
    value: string | null;
  } | null>(null);
  const installUrl =
    installUrlOverride?.agentDbId === agentDbId ? installUrlOverride.value : loaded?.installUrl ?? null;
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const loading = resource.isPending;
  const loadError = resource.error?.message ?? null;
  const display: AgentGithubDisplay = buildAgentGithubDisplay(
    connection,
    snapshot,
    devProofActive,
  );
  async function connectRepo() {
    if (!isPremiumVerified) {
      showToast("Verify this agent before connecting GitHub", "error");
      return;
    }
    const repoFullName = normalizeGithubRepoFullName(repo);
    if (!repoFullName) {
      showToast("Enter owner/repo or a full github.com URL", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName }),
      });
      const data = await readJsonResponse<{
        connection?: GithubConnection;
        installUrl?: string;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error ?? "Failed to connect repository");
      setLocalData({
        agentDbId,
        connection: data.connection ?? null,
        snapshot,
        installUrl: data.installUrl ?? null,
      });
      setRepo(repoFullName);
      const nextInstallUrl = data.installUrl ?? null;
      if (nextInstallUrl) {
        setInstallUrlOverride({ agentDbId, value: nextInstallUrl });
        setInstallDialogOpen(true);
      }
      onUpdated();
      router.refresh();
      showToast("Repository connected — install the GitHub App to finish setup", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to connect repository", "error");
    } finally {
      setBusy(false);
    }
  }
  async function syncRepo() {
    setBusy(true);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/github`, { method: "PATCH" });
      const data = await readJsonResponse<{
        connection?: GithubConnection;
        snapshot?: GithubSnapshot;
        error?: string;
      }>(res);
      if (!res.ok) {
        throw new Error(
          data.error ??
            (res.status === 502
              ? "GitHub sync failed — check repo name and GITHUB_PAT in .env.local"
              : "Sync failed"),
        );
      }
      setLocalData({
        agentDbId,
        connection: data.connection ?? connection,
        snapshot: data.snapshot ?? snapshot,
        installUrl,
      });
      onUpdated();
      router.refresh();
      showToast("DevProof sync complete", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Sync failed", "error");
    } finally {
      setBusy(false);
    }
  }
  if (loading) {
    return (
      <div className="ui-overview-panel flex items-center gap-2 rounded-xl p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading GitHub connection…
      </div>
    );
  }
  return (
    <>
      <div id="github-connect" className="space-y-4">
        {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
        <section className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity flex items-start gap-3 px-4 py-3.5 sm:px-5">
          <div className="ui-module-card-icon ui-module-card-icon--neutral">
            <GithubLogo className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">GitHub DevProof</h1>
              <DashboardStatusBadge
                variant={isPremiumVerified ? "verified" : "setup"}
                label={isPremiumVerified ? "Agent verified" : "Verify agent first"}
              />
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Link a GitHub repo via the AgentRanking DevProof app. After install, sync commits and
              releases to activate DevProof on your public profile.
            </p>
          </div>
        </div>
        {display.hasSnapshot ? (
          <div className="ui-overview-metrics grid grid-cols-2 sm:grid-cols-4">
            {[
              { label: "30d commits", value: display.commitCount30d },
              { label: "Contributors", value: display.contributorCount },
              { label: "Releases", value: display.releaseCount },
              {
                label: "Last commit",
                value: display.lastCommitAt
                  ? formatPortfolioRelative(display.lastCommitAt)
                  : "—",
              },
            ].map((metric) => (
              <div key={metric.label} className="ui-overview-metric px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{metric.label}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">{metric.value ?? "—"}</p>
              </div>
            ))}
          </div>
        ) : null}
        </section>
        {!isPremiumVerified ? (
          <div className="ui-github-verify-gate">
            <p className="text-sm text-muted-foreground">
              GitHub DevProof is available for AgentRanking-verified agents. Verify ownership first,
              then return here to connect a repository.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href={`/dashboard/agents/${agentDbId}/verify`}>Verify this agent</Link>
            </Button>
          </div>
        ) : null}
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">Repository status</h2>
          </div>
          <div className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <DashboardStatusBadge
              variant={display.connectionStatusLabel === "Not connected" ? "not_connected" : "connected"}
              label={display.connectionStatusLabel}
            />
            {display.devProofActive ? (
              <DashboardStatusBadge variant="connected" label="DevProof active" />
            ) : display.hasConnection ? (
              <DashboardStatusBadge variant="setup" label="Sync required" />
            ) : null}
          </div>
          {display.repoFullName ? (
            <p className="text-sm font-mono truncate mt-2">{display.repoFullName}</p>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">No repository linked yet</p>
          )}
          {display.visibility ? (
            <p className="text-[10px] text-muted-foreground capitalize mt-1">
              Visibility: {display.visibility}
            </p>
          ) : null}
          {display.lastSyncedAt ? (
            <p className="text-[10px] text-muted-foreground mt-1">
              Last synced {formatPortfolioRelative(display.lastSyncedAt)}
            </p>
          ) : null}
          </div>
        </section>
        {!display.hasSnapshot && display.hasConnection ? (
          <p className="text-xs text-muted-foreground">
            No snapshot yet — install the GitHub App if prompted, then run sync.
          </p>
        ) : null}
        {display.snapshotCapturedAt ? (
          <p className="text-[10px] text-muted-foreground">
            Snapshot captured {formatPortfolioRelative(display.snapshotCapturedAt)}
          </p>
        ) : null}
        {display.hasSnapshot ? (
          <DashboardGithubPushList
            key={display.snapshotCapturedAt?.toISOString() ?? "no-snapshot"}
            agentDbId={agentDbId}
            initialPushes={initialPushes}
            snapshotCapturedAt={display.snapshotCapturedAt?.toISOString() ?? null}
            initialSnapshotCapturedAt={initialData.snapshots[0]?.capturedAt ?? null}
            onChanged={() => {
              onUpdated();
              refreshGithub();
            }}
          />
        ) : null}
        {isPremiumVerified ? (
          <>
            <label className="block">
              <span className="ui-field-label">Repository</span>
              <input
                className="ui-github-repo-input mt-1.5"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repo or https://github.com/owner/repo"
              />
            </label>
            {installUrl && connection?.status === "pending" ? (
              <p className="text-xs text-muted-foreground">
                GitHub App install pending —{" "}
                <button
                  type="button"
                  className="text-foreground underline underline-offset-4"
                  onClick={() => setInstallDialogOpen(true)}
                >
                  open install steps
                </button>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || !repo.trim()}
                onClick={() => void connectRepo()}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Connect repo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !display.hasConnection}
                onClick={() => void syncRepo()}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Sync DevProof
              </Button>
            </div>
          </>
        ) : null}
      </div>
      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
          <div className="border-b border-border bg-muted/20 px-6 pt-6 pb-4">
            <DialogHeader className="space-y-3 text-left">
              <div className="flex items-start gap-3">
                <div className="ui-module-card-icon ui-module-card-icon--neutral">
                  <GithubLogo className="h-4 w-4" aria-hidden />
                </div>
                <div>
                  <DialogTitle className="text-base">Install GitHub App</DialogTitle>
                  <DialogDescription className="text-xs leading-relaxed mt-1">
                    Repository linked for{" "}
                    <span className="font-mono text-foreground">{display.repoFullName}</span>.
                    Install the AgentRanking DevProof app on GitHub, grant access to this repo, then
                    return and run sync.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>
          <div className="px-6 py-4 space-y-3 text-sm text-muted-foreground">
            <ol className="list-decimal list-inside space-y-2 text-xs leading-relaxed">
              <li>Open GitHub and install the AgentRanking DevProof app</li>
              <li>Select the repository you just connected</li>
              <li>Return here and click Sync DevProof</li>
            </ol>
            {installUrl ? (
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:underline"
              >
                Open GitHub install page
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : null}
          </div>
          <DialogFooter className="border-t border-border px-6 py-4 sm:justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setInstallDialogOpen(false)}>
              Done for now
            </Button>
            {installUrl ? (
              <Button asChild size="sm">
                <a href={installUrl} target="_blank" rel="noopener noreferrer">
                  Install on GitHub
                </a>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
export default DashboardGithubPanel;
