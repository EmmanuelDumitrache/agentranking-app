"use client";
import { useCallback, useState } from "react";
import { useAsyncResource } from "@/hooks/use-async-resource";
import Link from "next/link";
import { ArrowLeft, Loader2, Radio, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { DashboardServicesPanel } from "@/components/dashboard/services/services-panel";
import type { ServiceMetadataSnapshot } from "@/lib/dashboard/service-metadata";
import type { ServiceDiscoveryResult } from "@/lib/dashboard/service-discovery";
import { showToast } from "@/components/ui/toast-simple";
import { DashboardMcpOffersEditor, type McpOfferRow } from "@/components/dashboard/mcp-offers-editor";
import type { DashboardServicesWorkspaceDto } from "@/lib/dashboard/service-workspace.server";
type Props = {
  agentDbId: number;
  agentName: string;
  agentImage: string;
  publicProfileUrl: string;
  initialState: DashboardServicesWorkspaceDto;
  initialMcpOffers: McpOfferRow[];
};
type EditorPayload = {
  services: Array<{ id: number; name: string; endpoint: string; version: string }>;
  metadata: ServiceMetadataSnapshot;
  x402Support: boolean;
  signals: Array<{
    signalType: string;
    status: string;
    value: string;
    payloadJson?: unknown;
    lastCheckedAt?: string | Date | null;
    expiresAt?: string | Date | null;
  }>;
  discovered: ServiceDiscoveryResult;
  usage: DashboardServicesWorkspaceDto["usage"];
};
export function DashboardServicesAgentEdit({
  agentDbId,
  agentName,
  agentImage,
  publicProfileUrl,
  initialState,
  initialMcpOffers,
}: Props) {
  const [importing, setImporting] = useState(false);
  const load = useCallback(async (signal: AbortSignal): Promise<EditorPayload> => {
    const [response, usageResponse] = await Promise.all([
      fetch(`/api/dashboard/agents/${agentDbId}/services`, { signal }),
      fetch(`/api/dashboard/agents/${agentDbId}/services/analytics`, { signal }),
    ]);
    const data = (await response.json()) as Omit<EditorPayload, "usage"> & { error?: string };
    const usage = (await usageResponse.json()) as DashboardServicesWorkspaceDto["usage"] & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Failed to load services");
    if (!usageResponse.ok) throw new Error(usage.error ?? "Failed to load service usage");
    return {
      services: data.services ?? [],
      metadata: data.metadata ?? { mcpTools: [], a2aSkills: [], oasfSkills: [] },
      x402Support: data.x402Support === true,
      signals: data.signals ?? [],
      discovered: data.discovered ?? emptyDiscovery(),
      usage,
    };
  }, [agentDbId]);
  const resourceKey = `services-agent:${agentDbId}`;
  const resource = useAsyncResource(resourceKey, load, {
    initialData: initialState,
    initialDataKey: resourceKey,
    revalidateOnMount: false,
  });
  const payload = resource.data;
  const loading = resource.loading;
  const error = resource.error?.message ?? null;
  const refreshServices = resource.refresh;
  const runImport = useCallback(async (silent = false) => {
    setImporting(true);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/services/import-detected`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        importedServices?: number;
        importedMetadataKeys?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      const count = (data.importedServices ?? 0) + (data.importedMetadataKeys?.length ?? 0);
      if (count > 0) {
        if (!silent) {
          showToast(
            `Imported ${data.importedServices ?? 0} endpoint(s) and ${data.importedMetadataKeys?.length ?? 0} metadata list(s) from registration.`,
            "success",
          );
        }
        refreshServices();
        return true;
      }
      if (!silent) showToast("Nothing new to import from registration.", "success");
      return false;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Import failed", "error");
      return false;
    } finally {
      setImporting(false);
    }
  }, [agentDbId, refreshServices]);
  const publicHref = publicProfileUrl;
  const x402Detected =
    payload?.x402Support === true ||
    (payload?.signals ?? []).some(
      (signal) =>
        signal.signalType === "x402_detected" &&
        ["verified", "detected", "partner_registered"].includes(signal.status),
    );
  const hasDetectable =
    payload &&
    (payload.discovered.services.length > 0 ||
      payload.discovered.metadata.mcpTools.length > 0 ||
      payload.discovered.metadata.a2aSkills.length > 0);
  return (
    <div className="space-y-4 max-w-4xl">
      <Button variant="ghost" size="sm" className="h-8 -ml-2 text-muted-foreground" asChild>
        <Link href="/dashboard">
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back to Services
        </Link>
      </Button>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <AgentAvatar image={agentImage} name={agentName} size="md" className="rounded-xl" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-emerald-400 shrink-0" />
              <h1 className="text-xl font-bold truncate">{agentName}</h1>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Endpoints and MCP/A2A profile listings — auto-detected from your on-chain registration.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {hasDetectable ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={importing || loading}
              onClick={() => void runImport(false)}
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1" />
              )}
              Re-scan registration
            </Button>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <Link href={publicHref} target="_blank">
              View public profile
            </Link>
          </Button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading services…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : payload ? (
        <div className="space-y-4">
          <DashboardServicesPanel
            agentDbId={agentDbId}
            services={payload.services}
            signals={payload.signals}
            x402Detected={x402Detected}
            metadataSnapshot={payload.metadata}
            discovered={payload.discovered}
            onUpdated={refreshServices}
            showProfileMetadata
            compactUsage
            initialUsage={payload.usage}
          />
          <DashboardMcpOffersEditor
            agentDbId={agentDbId}
            profilePath={publicHref}
            services={payload.services}
            initialOffers={initialMcpOffers}
          />
        </div>
      ) : null}
    </div>
  );
}
function emptyDiscovery(): ServiceDiscoveryResult {
  return {
    agentUri: null,
    source: "none",
    services: [],
    metadata: { mcpTools: [], a2aSkills: [], oasfSkills: [] },
    importableServices: [],
    importableMetadata: {},
    prefill: {
      mcp: { name: "MCP", endpoint: "", version: "" },
      a2a: { name: "A2A", endpoint: "", version: "" },
      x402: { name: "X402", endpoint: "", version: "" },
      api: { name: "API", endpoint: "", version: "" },
    },
  };
}
export default DashboardServicesAgentEdit;
