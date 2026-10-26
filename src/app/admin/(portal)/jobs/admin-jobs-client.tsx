"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, BriefcaseBusiness, ChevronDown, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { showToast } from "@/components/ui/toast-simple";
import {
  PARTNER_SOURCE_STATUS_LABELS,
  getJobPartnerBrand,
  type PartnerSourceDisplayStatus,
} from "@/lib/jobs/partners/branding";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
type JobsByIngestionMode = {
  api: number;
  feed: number;
  manual: number;
  seed: number;
};
export type AdminPartnerJobSourceDto = {
  source: string;
  displayName: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  jobCount: number;
  staleJobCount: number;
  websiteUrl: string;
  docsUrl: string | null;
  displayStatus: string;
  statusDetail: string;
  lastIngestionMode: string | null;
  authModeUsed: string | null;
  lastHttpStatus: number | null;
  endpointUsed: string | null;
  lastSuccessfulSyncAt: string | null;
  apiKeyPresent: boolean;
  jobsByIngestionMode: JobsByIngestionMode;
};
export type AdminRecentPartnerJobDto = {
  id: string;
  source: string;
  title: string;
  status: string;
  ingestionMode: string;
  lastSeenAt: string;
  applyUrl: string;
  sourceUrl: string;
};
const EMPTY_CURATED = {
  source: "earnfi",
  title: "",
  description: "",
  category: "",
  jobType: "",
  rewardAmount: "",
  rewardCurrency: "USDC",
  chain: "solana",
  applyUrl: "",
  tags: "",
};
export function AdminJobsClient({
  initialData,
}: {
  readonly initialData: {
    partners: AdminPartnerJobSourceDto[];
    recentJobs: AdminRecentPartnerJobDto[];
  };
}) {
  const [syncing, setSyncing] = useState(false);
  const [showCuratedForm, setShowCuratedForm] = useState(false);
  const [curated, setCurated] = useState(EMPTY_CURATED);
  const [savingCurated, setSavingCurated] = useState(false);
  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch("/api/admin/jobs/status", { credentials: "include", signal });
    if (!response.ok) throw new Error("Failed to load");
    const payload = (await response.json()) as {
      partners?: AdminPartnerJobSourceDto[];
      recentJobs?: AdminRecentPartnerJobDto[];
    };
    return { partners: payload.partners ?? [], recentJobs: payload.recentJobs ?? [] };
  }, []);
  const queryClient = useQueryClient();
  const jobsQuery = useQuery({
    queryKey: adminKeys.jobs(),
    queryFn: ({ signal }) => load(signal),
    initialData,
    refetchOnMount: false,
  });
  const { data, error } = jobsQuery;
  const loading = jobsQuery.isPending;
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.jobs() });
  const partners = data?.partners ?? [];
  const recentJobs = data?.recentJobs ?? [];
  async function runSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/jobs/sync", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Sync failed");
      }
      showToast("Partner jobs sync queued");
      refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  }
  async function submitCurated(e: React.FormEvent) {
    e.preventDefault();
    setSavingCurated(true);
    try {
      const res = await fetch("/api/admin/jobs/curated", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...curated,
          tags: curated.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          status: "open",
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      showToast("Curated partner job saved");
      setCurated(EMPTY_CURATED);
      setShowCuratedForm(false);
      refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSavingCurated(false);
    }
  }
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      ) : null}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/admin"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Admin
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BriefcaseBusiness className="h-6 w-6" />
            Jobs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Partner sync, curated listings, and ingestion status.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowCuratedForm((v) => !v)}>
            <Plus className="mr-2 h-4 w-4" />
            Add curated job
            <ChevronDown className={cn("ml-1 h-4 w-4 transition", showCuratedForm && "rotate-180")} />
          </Button>
          <Button onClick={() => void runSync()} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync now
          </Button>
        </div>
      </div>
      {showCuratedForm ? (
        <form
          onSubmit={(e) => void submitCurated(e)}
          className="mb-6 rounded-lg border border-border bg-card/50 p-4 space-y-3"
        >
          <p className="text-sm font-medium">Add curated partner listing</p>
          <p className="text-xs text-muted-foreground">
            External partner job with a real apply URL. Not an AgentRanking-native posting.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cur-source">Source</Label>
              <select
                id="cur-source"
                value={curated.source}
                onChange={(e) => setCurated({ ...curated, source: e.target.value })}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="earnfi">EarnFi</option>
                <option value="wurk">WURK</option>
              </select>
            </div>
            <div>
              <Label htmlFor="cur-apply">Apply URL</Label>
              <Input
                id="cur-apply"
                value={curated.applyUrl}
                onChange={(e) => setCurated({ ...curated, applyUrl: e.target.value })}
                placeholder="https://..."
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="cur-title">Title</Label>
              <Input
                id="cur-title"
                value={curated.title}
                onChange={(e) => setCurated({ ...curated, title: e.target.value })}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="cur-desc">Description</Label>
              <textarea
                id="cur-desc"
                value={curated.description}
                onChange={(e) => setCurated({ ...curated, description: e.target.value })}
                className="mt-1 w-full min-h-[80px] rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                required
              />
            </div>
            <div>
              <Label htmlFor="cur-cat">Category</Label>
              <Input
                id="cur-cat"
                value={curated.category}
                onChange={(e) => setCurated({ ...curated, category: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cur-type">Job type</Label>
              <Input
                id="cur-type"
                value={curated.jobType}
                onChange={(e) => setCurated({ ...curated, jobType: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cur-reward">Reward amount</Label>
              <Input
                id="cur-reward"
                value={curated.rewardAmount}
                onChange={(e) => setCurated({ ...curated, rewardAmount: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cur-currency">Reward currency</Label>
              <Input
                id="cur-currency"
                value={curated.rewardCurrency}
                onChange={(e) => setCurated({ ...curated, rewardCurrency: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cur-chain">Chain</Label>
              <Input
                id="cur-chain"
                value={curated.chain}
                onChange={(e) => setCurated({ ...curated, chain: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cur-tags">Tags (comma-separated)</Label>
              <Input
                id="cur-tags"
                value={curated.tags}
                onChange={(e) => setCurated({ ...curated, tags: e.target.value })}
              />
            </div>
          </div>
          <Button type="submit" disabled={savingCurated}>
            {savingCurated ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save curated listing
          </Button>
        </form>
      ) : null}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Stale</TableHead>
                <TableHead>Last sync</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ingestion</TableHead>
                <TableHead>Last error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map((p) => {
                const brand = getJobPartnerBrand(p.source);
                const status = p.displayStatus as PartnerSourceDisplayStatus;
                return (
                  <TableRow key={p.source}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {brand ? (
                          <Image
                            src={brand.logoUrl}
                            alt={`${brand.displayName} logo`}
                            width={24}
                            height={24}
                            className="rounded"
                          />
                        ) : null}
                        <div>
                          <span className="font-medium">{p.displayName}</span>
                          {p.statusDetail ? (
                            <p className="mt-0.5 max-w-xs text-[10px] text-muted-foreground line-clamp-2">
                              {p.statusDetail}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{p.jobCount}</TableCell>
                    <TableCell>{p.staleJobCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {p.lastSyncAt ? format(new Date(p.lastSyncAt), "MMM d, HH:mm") : "Never"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.lastIngestionMode ?? "—"}
                      {p.authModeUsed ? ` (${p.authModeUsed})` : ""}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-destructive">
                      {p.lastSyncError ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {partners
            .filter((p) => p.source === "earnfi")
            .map((earnfi) => (
              <div
                key={earnfi.source}
                className="mt-6 rounded-lg border border-border bg-card/40 p-4"
              >
                <h2 className="text-sm font-semibold mb-3">EarnFi API diagnostics</h2>
                <dl className="grid gap-2 sm:grid-cols-2 text-xs">
                  <Diag label="API key present" value={earnfi.apiKeyPresent ? "Yes" : "No"} />
                  <Diag label="Endpoint" value={earnfi.endpointUsed ?? "—"} />
                  <Diag label="Auth mode used" value={earnfi.authModeUsed ?? "—"} />
                  <Diag
                    label="Last HTTP status"
                    value={earnfi.lastHttpStatus != null ? String(earnfi.lastHttpStatus) : "—"}
                  />
                  <Diag label="Last sync status" value={earnfi.lastSyncStatus ?? "—"} />
                  <Diag
                    label="Last successful sync"
                    value={
                      earnfi.lastSuccessfulSyncAt
                        ? format(new Date(earnfi.lastSuccessfulSyncAt), "MMM d, HH:mm")
                        : "—"
                    }
                  />
                  <Diag label="Active jobs" value={String(earnfi.jobCount)} />
                  <Diag
                    label="Jobs by mode"
                    value={`api ${earnfi.jobsByIngestionMode.api} · feed ${earnfi.jobsByIngestionMode.feed} · manual ${earnfi.jobsByIngestionMode.manual} · seed ${earnfi.jobsByIngestionMode.seed}`}
                  />
                  <Diag
                    label="Last sync error"
                    value={earnfi.lastSyncError ?? "—"}
                    className="sm:col-span-2"
                  />
                </dl>
              </div>
            ))}
          <h2 className="mt-10 mb-3 text-sm font-semibold">Recent jobs</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Link</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground py-6">
                    No partner jobs yet. Run sync or add a curated listing.
                  </TableCell>
                </TableRow>
              ) : (
                recentJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="capitalize text-xs">{job.source}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm">{job.title}</TableCell>
                    <TableCell className="text-xs">{job.ingestionMode}</TableCell>
                    <TableCell className="capitalize text-xs">{job.status}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(job.lastSeenAt), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {(job.applyUrl || job.sourceUrl) ? (
                        <a
                          href={job.applyUrl || job.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          Open
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </>
      )}
      <p className="mt-6 text-xs text-muted-foreground space-y-1">
        <span className="block">
          Public board: <Link href="/jobs" className="text-primary hover:underline">/jobs</Link>
        </span>
        <span className="block">
          Import curated JSON through the authenticated jobs administration workflow.
        </span>
        <span className="block">
          Env: <code className="text-foreground">EARNFI_WORK_API_KEY</code>,{" "}
          <code className="text-foreground">EARNFI_API_BASE_URL</code>,{" "}
          <code className="text-foreground">EARNFI_JOBS_LIST_PATH</code>,{" "}
          <code className="text-foreground">WURK_API_KEY</code>
        </span>
      </p>
    </div>
  );
}
function Diag({
  label,
  value,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-[11px] text-foreground break-all">{value}</dd>
    </div>
  );
}
function StatusBadge({ status }: { readonly status: PartnerSourceDisplayStatus }) {
  const label = PARTNER_SOURCE_STATUS_LABELS[status] ?? status;
  const styles: Record<PartnerSourceDisplayStatus, string> = {
    active: "border-emerald-500/30 text-emerald-400",
    missing_api_key: "border-amber-500/30 text-amber-400",
    awaiting_feed: "border-violet-500/30 text-violet-400",
    sync_pending: "border-border text-muted-foreground",
    sync_failed: "border-red-500/30 text-red-400",
    cached: "border-sky-500/30 text-sky-400",
    disabled: "border-border text-muted-foreground",
  };
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", styles[status])}>
      {label}
    </span>
  );
}
