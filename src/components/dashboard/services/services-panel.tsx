"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DashboardConfirmDeleteDialog } from "@/components/dashboard/shared/confirm-delete-dialog";
import { DashboardServiceTypeBadge } from "@/components/dashboard/shared/service-type-badge";
import {
  DashboardStatusBadge,
  type DashboardStatusBadgeVariant,
} from "@/components/dashboard/shared/status-badge";
import { resolveServiceHealth } from "@/lib/dashboard/service-health";
import { probeKindLabel } from "@/lib/dashboard/service-display";
import {
  DASHBOARD_SERVICE_TABS,
  classifyDashboardServiceType,
  dashboardServiceTypeLabel,
  countServicesByTab,
  defaultServiceNameForType,
  endpointPlaceholderForType,
  serviceMatchesTab,
  type DashboardServiceTab,
  type DashboardServiceType,
} from "@/lib/dashboard/service-type";
import {
  buildServiceMetadataSnapshot,
  metadataKeyForServiceTab,
  type ServiceMetadataSnapshot,
} from "@/lib/dashboard/service-metadata";
import type { ServiceDiscoveryResult } from "@/lib/dashboard/service-discovery";
import { formatPortfolioRelative } from "@/components/dashboard/portfolio/portfolio-utils";
import { showToast } from "@/components/ui/toast-simple";
import { cn } from "@/lib/utils";
import { DashboardServiceMetadataEditor } from "@/components/dashboard/services/service-metadata-editor";
import { DashboardServicesUsagePanel } from "@/components/dashboard/services/services-usage-panel";
import type { DashboardServiceUsageDto } from "@/lib/dashboard/service-workspace.server";
type ServiceRow = { id: number; name: string; endpoint: string; version: string };
type SignalRow = {
  signalType: string;
  status: string;
  value: string;
  payloadJson?: unknown;
  lastCheckedAt?: string | Date | null;
  expiresAt?: string | Date | null;
};
type EditorSection = "endpoints" | "mcp-tools" | "a2a-skills";
const KEEP_EMPTY_TABS = new Set<DashboardServiceTab>(["mcp", "a2a", "x402", "api", "website"]);
type Props = {
  agentDbId: number;
  services: ServiceRow[];
  signals?: SignalRow[];
  x402Detected?: boolean;
  metadata?: Array<{ key: string; value: string }>;
  metadataSnapshot?: ServiceMetadataSnapshot;
  discovered?: ServiceDiscoveryResult;
  onUpdated: () => void;
  showProfileMetadata?: boolean;
  compactUsage?: boolean;
  initialUsage?: DashboardServiceUsageDto;
};
function healthVariant(status: string): DashboardStatusBadgeVariant {
  switch (status) {
    case "live":
      return "live";
    case "failing":
      return "failing";
    case "stale":
      return "stale";
    default:
      return "no_data";
  }
}
function healthLabel(status: string): string {
  switch (status) {
    case "live":
      return "Live";
    case "failing":
      return "Failing";
    case "stale":
      return "Stale";
    default:
      return "Unknown";
  }
}
function metadataEditorTab(
  tab: DashboardServiceTab,
): "mcp" | "a2a" | "oasf" | null {
  if (tab === "mcp") return "mcp";
  if (tab === "a2a") return "a2a";
  if (tab === "custom") return "oasf";
  return null;
}
function prefillKeyForTab(tab: DashboardServiceTab): keyof ServiceDiscoveryResult["prefill"] | null {
  if (tab === "mcp") return "mcp";
  if (tab === "a2a") return "a2a";
  if (tab === "x402") return "x402";
  if (tab === "api" || tab === "website") return "api";
  return null;
}
export function DashboardServicesPanel({
  agentDbId,
  services,
  signals = [],
  x402Detected = false,
  metadata = [],
  metadataSnapshot: metadataSnapshotProp,
  discovered,
  onUpdated,
  showProfileMetadata = false,
  compactUsage = false,
  initialUsage,
}: Props) {
  const router = useRouter();
  const [editorSection, setEditorSection] = useState<EditorSection>("endpoints");
  const [activeTab, setActiveTab] = useState<DashboardServiceTab>("mcp");
  const [name, setName] = useState("MCP");
  const [endpoint, setEndpoint] = useState("");
  const [version, setVersion] = useState("");
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [bulkChecking, setBulkChecking] = useState(false);
  const [tabChecking, setTabChecking] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editService, setEditService] = useState<ServiceRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editEndpoint, setEditEndpoint] = useState("");
  const [editVersion, setEditVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ServiceRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const metadataSnapshot = metadataSnapshotProp ?? buildServiceMetadataSnapshot(metadata);
  const userEditedFormRef = useRef(false);
  const normalizedSignals = useMemo(
    () =>
      signals.map((s) => ({
        ...s,
        lastCheckedAt: s.lastCheckedAt ? new Date(s.lastCheckedAt) : null,
        expiresAt: s.expiresAt ? new Date(s.expiresAt) : null,
        payloadJson: s.payloadJson,
        value: s.value ?? "",
      })),
    [signals],
  );
  const tabCounts = useMemo(
    () => countServicesByTab(services, x402Detected),
    [services, x402Detected],
  );
  const visibleServices = useMemo(
    () => services.filter((service) => serviceMatchesTab(service, activeTab, x402Detected)),
    [services, activeTab, x402Detected],
  );
  const activeType: DashboardServiceType =
    activeTab === "all" ? "mcp" : activeTab;
  const applyPrefill = (tab: DashboardServiceTab, force = false) => {
    if (!discovered) return;
    const key = prefillKeyForTab(tab);
    if (!key) return;
    const prefill = discovered.prefill[key];
    const serviceType: DashboardServiceType = tab === "all" ? "mcp" : tab;
    if (!prefill.endpoint && !prefill.version) {
      setName(prefill.name || defaultServiceNameForType(serviceType));
      return;
    }
    if (!force && userEditedFormRef.current) return;
    setName(prefill.name || defaultServiceNameForType(serviceType));
    setEndpoint(prefill.endpoint);
    setVersion(prefill.version);
  };
  const selectActiveTab = (tab: DashboardServiceTab) => {
    setActiveTab(tab);
    if (tab !== "all") applyPrefill(tab);
  };
  async function addService() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, endpoint, version }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to add service");
      userEditedFormRef.current = false;
      setEndpoint("");
      setVersion("");
      applyPrefill(activeTab, true);
      onUpdated();
      router.refresh();
      showToast("Endpoint added", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to add endpoint", "error");
    } finally {
      setSaving(false);
    }
  }
  async function saveEdit() {
    if (!editService) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/services`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editService.id,
          name: editName,
          endpoint: editEndpoint,
          version: editVersion,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to update service");
      setEditOpen(false);
      onUpdated();
      router.refresh();
      showToast("Endpoint updated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to update endpoint", "error");
    } finally {
      setSaving(false);
    }
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/dashboard/agents/${agentDbId}/services?id=${deleteTarget.id}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete service");
      setDeleteOpen(false);
      setDeleteTarget(null);
      onUpdated();
      router.refresh();
      showToast("Endpoint removed", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete endpoint", "error");
    } finally {
      setDeleting(false);
    }
  }
  async function runCheck(serviceIds?: number[]) {
    const singleId = serviceIds?.length === 1 ? serviceIds[0] : undefined;
    if (singleId) setCheckingId(singleId);
    else if (serviceIds && serviceIds.length > 0) setTabChecking(true);
    else setBulkChecking(true);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/services/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          singleId
            ? { serviceId: singleId }
            : serviceIds && serviceIds.length > 0
              ? { serviceIds }
              : {},
        ),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Health check failed");
      onUpdated();
      router.refresh();
      showToast("Health check complete", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Health check failed", "error");
    } finally {
      setCheckingId(null);
      setBulkChecking(false);
      setTabChecking(false);
    }
  }
  function openEdit(service: ServiceRow) {
    setEditService(service);
    setEditName(service.name);
    setEditEndpoint(service.endpoint);
    setEditVersion(service.version);
    setEditOpen(true);
  }
  const metadataTab = showProfileMetadata ? null : metadataEditorTab(activeTab);
  const sectionTabs: { id: EditorSection; label: string; count?: number }[] = showProfileMetadata
    ? [
        { id: "endpoints", label: "Endpoints", count: services.length },
        { id: "mcp-tools", label: "Published MCP tools", count: metadataSnapshot.mcpTools.length },
        { id: "a2a-skills", label: "A2A skills", count: metadataSnapshot.a2aSkills.length },
      ]
    : [];
  const suggestedEndpoint =
    discovered && activeTab !== "all" ? discovered.prefill[prefillKeyForTab(activeTab) ?? "mcp"] : null;
  const hasSuggestedEndpoint =
    suggestedEndpoint != null &&
    suggestedEndpoint.endpoint.trim().length > 0 &&
    !services.some(
      (s) => s.endpoint.trim().toLowerCase() === suggestedEndpoint.endpoint.trim().toLowerCase(),
    );
  return (
    <div className="space-y-3">
      <DashboardServicesUsagePanel
        agentDbId={agentDbId}
        compact={compactUsage}
        initialData={initialUsage}
      />
      {showProfileMetadata && sectionTabs.length > 0 ? (
        <div className="flex flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/10 p-1">
          {sectionTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setEditorSection(tab.id)}
              className={cn(
                "flex-1 min-w-[100px] rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                editorSection === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.count != null ? (
                <span className="ml-1.5 tabular-nums text-[10px] opacity-70">{tab.count}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {showProfileMetadata && editorSection === "mcp-tools" ? (
        <DashboardServiceMetadataEditor
          agentDbId={agentDbId}
          tab="mcp"
          initialItems={metadataSnapshot.mcpTools}
          detectedItems={discovered?.metadata.mcpTools}
          onSaved={onUpdated}
        />
      ) : null}
      {showProfileMetadata && editorSection === "a2a-skills" ? (
        <DashboardServiceMetadataEditor
          agentDbId={agentDbId}
          tab="a2a"
          initialItems={metadataSnapshot.a2aSkills}
          detectedItems={discovered?.metadata.a2aSkills}
          onSaved={onUpdated}
        />
      ) : null}
      {(!showProfileMetadata || editorSection === "endpoints") ? (
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                Service endpoints
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                MCP, A2A, x402, API, and website URLs. Auto-imported from your agent registration when available.
              </p>
            </div>
            {services.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs shrink-0"
                disabled={bulkChecking}
                onClick={() => void runCheck()}
              >
                {bulkChecking ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Check all
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DASHBOARD_SERVICE_TABS.map((tab) => {
              const count = tabCounts[tab];
              if (tab !== "all" && count === 0 && !KEEP_EMPTY_TABS.has(tab)) return null;
              const label = tab === "all" ? "All" : dashboardServiceTypeLabel(tab);
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => selectActiveTab(tab)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    activeTab === tab
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-background/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  <span className="ml-1 tabular-nums text-[10px] opacity-80">{count}</span>
                </button>
              );
            })}
          </div>
          {metadataTab ? (
            <DashboardServiceMetadataEditor
              agentDbId={agentDbId}
              tab={metadataTab}
              initialItems={metadataSnapshot[metadataKeyForServiceTab(metadataTab)]}
              detectedItems={
                metadataTab === "mcp"
                  ? discovered?.metadata.mcpTools
                  : metadataTab === "a2a"
                    ? discovered?.metadata.a2aSkills
                    : discovered?.metadata.oasfSkills
              }
              onSaved={onUpdated}
              compact
            />
          ) : null}
          {visibleServices.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {activeTab === "all"
                  ? "No endpoints yet"
                  : `No ${dashboardServiceTypeLabel(activeTab)} endpoints`}
              </p>
              {hasSuggestedEndpoint ? (
                <p className="text-xs text-emerald-400/90 mt-1 font-mono truncate max-w-md mx-auto">
                  Detected: {suggestedEndpoint.endpoint}
                </p>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y divide-border/50 rounded-lg border border-border/60 overflow-hidden">
              {visibleServices.map((s) => {
                const health = resolveServiceHealth(s.id, s.name, s.endpoint, normalizedSignals);
                const probeKind = health.checkType
                  ? health.checkType
                  : classifyDashboardServiceType({
                      name: s.name,
                      endpoint: s.endpoint,
                      x402Detected,
                    }) === "x402"
                    ? "x402"
                    : "http";
                const probeKindLabelText = probeKindLabel(
                  probeKind as "http" | "a2a_card" | "x402" | "not_probeable",
                );
                const statusLabel =
                  health.status === "unknown" && !s.endpoint.trim()
                    ? "Not probeable"
                    : healthLabel(health.status);
                return (
                  <li key={s.id} className="px-3 py-2.5 bg-background/40 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-sm">{s.name}</span>
                          <DashboardServiceTypeBadge
                            name={s.name}
                            endpoint={s.endpoint}
                            x402Detected={x402Detected}
                          />
                          <DashboardStatusBadge
                            variant={healthVariant(health.status)}
                            label={statusLabel}
                          />
                          {s.version ? (
                            <span className="text-[10px] text-muted-foreground">v{s.version}</span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground truncate font-mono mt-0.5">
                          {s.endpoint || "—"}
                        </p>
                      </div>
                      <div className="flex gap-0.5 shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => openEdit(s)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-red-400"
                          onClick={() => {
                            setDeleteTarget(s);
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span>Last: {formatPortfolioRelative(health.lastCheckedAt)}</span>
                      <span>{probeKindLabelText}</span>
                      {health.httpStatus != null ? <span>HTTP {health.httpStatus}</span> : null}
                      {health.responseTimeMs != null ? <span>{health.responseTimeMs}ms</span> : null}
                    </div>
                    {health.error ? (
                      <p className="text-[10px] text-red-400/90">{health.error}</p>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px] text-muted-foreground"
                      disabled={checkingId === s.id || !s.endpoint.trim()}
                      onClick={() => void runCheck([s.id])}
                    >
                      {checkingId === s.id ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : null}
                      Check
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2">
            <p className="text-xs font-medium flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" />
              Add {activeTab === "all" ? "endpoint" : dashboardServiceTypeLabel(activeTab)}
            </p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,0.75fr)]">
              <input
                className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm h-9"
                value={name}
                onChange={(e) => {
                  userEditedFormRef.current = true;
                  setName(e.target.value);
                }}
                placeholder="Name"
              />
              <input
                className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm h-9 font-mono text-xs"
                value={endpoint}
                onChange={(e) => {
                  userEditedFormRef.current = true;
                  setEndpoint(e.target.value);
                }}
                placeholder={
                  activeTab === "all"
                    ? "https://…"
                    : endpointPlaceholderForType(activeType)
                }
              />
              <input
                className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm h-9"
                value={version}
                onChange={(e) => {
                  userEditedFormRef.current = true;
                  setVersion(e.target.value);
                }}
                placeholder="Version"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={saving || !name.trim()} onClick={() => void addService()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Add endpoint
              </Button>
              {hasSuggestedEndpoint ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    userEditedFormRef.current = false;
                    applyPrefill(activeTab, true);
                  }}
                >
                  Use detected URL
                </Button>
              ) : null}
              {activeTab !== "all" && visibleServices.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={tabChecking}
                  onClick={() => void runCheck(visibleServices.map((s) => s.id))}
                >
                  {tabChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  Check this tab
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit endpoint</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Service name"
            />
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-xs"
              value={editEndpoint}
              onChange={(e) => setEditEndpoint(e.target.value)}
              placeholder="Endpoint URL"
            />
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              value={editVersion}
              onChange={(e) => setEditVersion(e.target.value)}
              placeholder="Version"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void saveEdit()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DashboardConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete endpoint?"
        description={`Remove "${deleteTarget?.name ?? "this endpoint"}"? This cannot be undone.`}
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
