"use client";
import { useCallback, useState } from "react";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useSourceDraft } from "@/hooks/use-source-draft";
import Link from "next/link";
import { Cpu, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InferenceProviderPicker } from "@/components/inference/inference-provider-picker";
import { InferencePlayground } from "@/components/inference/inference-playground";
import { showToast } from "@/components/ui/toast-simple";
import { getInferenceProviderById } from "@/lib/inference-providers/registry";
import type { DashboardInferenceState } from "@/lib/inference-providers/dashboard-state.server";
type Props = {
  agentDbId: number;
  agentName: string;
  publicProfilePath: string;
  initialState: DashboardInferenceState;
};
type InferencePayload = {
  providerIds: string[];
  providers: Array<{
    id: string;
    name: string;
    description: string;
    endpoint: string;
    x402DescriptorUrl: string;
    mcpPackage: string | null;
    docsUrl: string | null;
  }>;
  x402Descriptor: {
    fetchedAt: string;
    endpointCount: number;
    capabilities: string[];
  } | null;
  modelsCatalog: {
    fetchedAt: string;
    sourceUrl: string;
    modelCount: number;
    models: Array<{
      id: string;
      tier: string | null;
      inputPerMtok: number | null;
      outputPerMtok: number | null;
      freeEligible: boolean;
    }>;
  } | null;
};
export function ConsoleInferenceAgentPanel({
  agentDbId,
  agentName,
  publicProfilePath,
  initialState,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [savedPayload, setSavedPayload] = useState<{ agentDbId: number; data: InferencePayload } | null>(null);
  const load = useCallback(async (signal: AbortSignal): Promise<InferencePayload> => {
    const response = await fetch(`/api/dashboard/agents/${agentDbId}/inference-providers`, { signal });
    const data = (await response.json()) as InferencePayload & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Failed to load inference settings");
    return data;
  }, [agentDbId]);
  const resourceKey = `inference-settings:${agentDbId}`;
  const resource = useAsyncResource(resourceKey, load, {
    initialData: initialState,
    initialDataKey: resourceKey,
    revalidateOnMount: false,
  });
  const payload = savedPayload?.agentDbId === agentDbId ? savedPayload.data : resource.data;
  const providerSourceKey = `${agentDbId}:${payload?.providerIds[0] ?? "none"}`;
  const [selectedProviderId, setSelectedProviderId] = useSourceDraft<string | null>(
    providerSourceKey,
    payload?.providerIds[0] ?? null,
  );
  const loading = resource.loading;
  const error = mutationError ?? resource.error?.message ?? null;
  const save = useCallback(async () => {
    setSaving(true);
    setMutationError(null);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/inference-providers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerIds: selectedProviderId ? [selectedProviderId] : [],
        }),
      });
      const data = (await res.json()) as InferencePayload & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSavedPayload({ agentDbId, data });
      setSelectedProviderId(data.providerIds[0] ?? null);
      showToast("Inference provider settings saved.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Save failed";
      setMutationError(message);
      showToast(message);
    } finally {
      setSaving(false);
    }
  }, [agentDbId, selectedProviderId, setSelectedProviderId]);
  const activeProvider = selectedProviderId ? getInferenceProviderById(selectedProviderId) : null;
  if (loading) {
    return (
      <div className="ui-dashboard-overview mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-6 min-w-0">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading inference settings…
      </div>
    );
  }
  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
      <div className="ui-overview-identity flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-muted-foreground" aria-hidden />
            <h1 className="text-xl font-semibold tracking-tight">Inference</h1>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Configure how <span className="font-medium text-foreground">{agentName}</span> advertises
            inference routing, x402 descriptors, and MCP tooling.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={publicProfilePath} target="_blank" rel="noopener noreferrer">
            Public profile
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      </div>
      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-semibold">Provider routing</h2>
        </div>
        <div className="px-5 py-4">
          <InferenceProviderPicker value={selectedProviderId} onChange={setSelectedProviderId} disabled={saving} />
        </div>
      </section>
      {activeProvider ? (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">MCP registration</h2>
          </div>
          <div className="space-y-3 px-5 py-4 text-sm">
          <p className="text-muted-foreground text-xs">
            Register the MCP server in your agent runtime so callers can discover OpenVecta tools.
            Use the playground below to verify x402 pay-per-call inference from your wallet.
          </p>
          {activeProvider.metadata.mcpPackage ? (
            <div className="rounded-md border border-border bg-muted p-3 font-mono text-xs">
              npm install {activeProvider.metadata.mcpPackage}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 text-xs">
            {activeProvider.x402DescriptorUrl ? (
              <a
                href={activeProvider.x402DescriptorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline-offset-2 hover:underline"
              >
                x402 descriptor
              </a>
            ) : null}
            {activeProvider.metadata.docs ? (
              <a
                href={activeProvider.metadata.docs}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline-offset-2 hover:underline"
              >
                Provider docs
              </a>
            ) : null}
            <Link
              href={`/docs/partners/${activeProvider.id}`}
              className="text-foreground underline-offset-2 hover:underline"
            >
              AgentRanking partner page
            </Link>
          </div>
          {payload?.x402Descriptor ? (
            <p className="text-muted-foreground text-xs">
              Indexed descriptor: {payload.x402Descriptor.endpointCount} endpoints · last fetched{" "}
              {new Date(payload.x402Descriptor.fetchedAt).toLocaleString()}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              Descriptor not cached yet — the pg-boss worker refreshes provider manifests every 6 hours.
            </p>
          )}
          {payload?.modelsCatalog ? (
            <p className="text-muted-foreground text-xs">
              Model catalog: {payload.modelsCatalog.modelCount} chat models · last fetched{" "}
              {new Date(payload.modelsCatalog.fetchedAt).toLocaleString()}
            </p>
          ) : null}
          </div>
        </section>
      ) : null}
      {activeProvider ? (
        <InferencePlayground
          providerId={activeProvider.id}
          disabled={saving}
          catalogModels={
            payload?.modelsCatalog?.models.map((model) => ({
              id: model.id,
              provider: null,
              modality: null,
              tier: model.tier,
              freeEligible: model.freeEligible,
              inputPerMtok: model.inputPerMtok,
              outputPerMtok: model.outputPerMtok,
              flatFeeUsd: null,
            })) ?? null
          }
        />
      ) : null}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save inference settings"}
        </Button>
        <Button variant="outline" onClick={resource.refresh} disabled={saving}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
