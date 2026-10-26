"use client";
import { useCallback } from "react";
import { useAsyncResource } from "@/hooks/use-async-resource";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import {
  DashboardMonetizationPanel,
  type PaidServiceRow,
} from "@/components/dashboard/monetization/monetization-panel";
import { parseX402SignalState, x402SummaryLabel } from "@/lib/dashboard/x402-display";
import { computeMonetizationReadiness } from "@/lib/dashboard/monetization-readiness";
import type {
  DashboardMonetizationWorkspaceDto,
  DashboardPaidServiceDto,
} from "@/lib/dashboard/x402-monetization-workspace.server";
type Props = {
  agentDbId: number;
  agentName: string;
  agentImage: string;
  publicProfileUrl: string;
  initialState: DashboardMonetizationWorkspaceDto;
};
type AgentPayload = {
  agent?: {
    agentId: number;
    chainId: number;
    owner: string;
    verifiedWallet: string | null;
    paidServices: PaidServiceRow[];
    metadata?: Array<{ key: string; value: string }>;
  };
  trust?: {
    signals?: Array<{
      signalType: string;
      status: string;
      value: string;
      payloadJson?: unknown;
      lastCheckedAt?: string | Date | null;
    }>;
  };
  error?: string;
};
export function DashboardMonetizationAgentEdit({
  agentDbId,
  agentName,
  agentImage,
  publicProfileUrl,
  initialState,
}: Props) {
  const load = useCallback(async (signal: AbortSignal): Promise<DashboardMonetizationWorkspaceDto> => {
    const [agentRes, paidRes] = await Promise.all([
      fetch(`/api/dashboard/agents/${agentDbId}`, { signal }),
      fetch(`/api/dashboard/agents/${agentDbId}/paid-services`, { signal }),
    ]);
    const agentData = (await agentRes.json()) as AgentPayload;
    const paidData = (await paidRes.json()) as { paidServices?: PaidServiceRow[]; error?: string };
    if (!agentRes.ok) throw new Error(agentData.error ?? "Failed to load agent");
    if (!agentData.agent) throw new Error("Agent not found");
    if (!paidRes.ok) throw new Error(paidData.error ?? "Failed to load paid services");
    const paidServices: DashboardPaidServiceDto[] = (
      paidData.paidServices ?? agentData.agent.paidServices ?? []
    ).map((service) => ({
      id: service.id,
      title: service.title,
      description: service.description,
      serviceType: service.serviceType,
      endpointUrl: service.endpointUrl,
      priceUsd: service.priceUsd ?? null,
      priceLabel: service.priceLabel,
      paymentWallet: service.paymentWallet,
      sampleResponse: service.sampleResponse,
      isPublished: service.isPublished,
    }));
    const agent = {
      agentId: agentData.agent.agentId,
      chainId: agentData.agent.chainId,
      owner: agentData.agent.owner,
      verifiedWallet: agentData.agent.verifiedWallet,
      paidServices,
    };
    const signals = (agentData.trust?.signals ?? []).map((signal) => ({
      signalType: signal.signalType,
      status: signal.status,
      value: signal.value ?? "",
      payloadJson: signal.payloadJson ?? null,
      lastCheckedAt:
        typeof signal.lastCheckedAt === "string"
          ? signal.lastCheckedAt
          : signal.lastCheckedAt?.toISOString() ?? null,
    }));
    const metadata = agentData.agent.metadata ?? [];
    return {
      agent,
      signals,
      trustedWallets: [agent.owner.trim(), agent.verifiedWallet?.trim()]
        .filter((wallet): wallet is string => Boolean(wallet)),
      readiness: computeMonetizationReadiness({
        signals,
        paidServiceCount: agent.paidServices.length,
        hasPricing: agent.paidServices.some((service) =>
          (service.priceUsd != null && service.priceUsd > 0) || Boolean(service.priceLabel?.trim())),
        hasDocs: metadata.some((entry) => entry.key === "docs" && Boolean(entry.value.trim())),
      }),
    };
  }, [agentDbId]);
  const resourceKey = `monetization-agent:${agentDbId}`;
  const resource = useAsyncResource(resourceKey, load, {
    initialData: initialState,
    initialDataKey: resourceKey,
    revalidateOnMount: false,
  });
  const loading = resource.loading;
  const error = resource.error?.message ?? null;
  const payload = resource.data?.agent ?? null;
  const signals = resource.data?.signals ?? [];
  const trustedWallets = resource.data?.trustedWallets ?? [];
  const publicProfileHref = payload != null ? publicProfileUrl : undefined;
  const paidCount = payload?.paidServices.length ?? 0;
  const publishedCount = payload?.paidServices.filter((s) => s.isPublished === true).length ?? 0;
  const draftCount = paidCount - publishedCount;
  const x402Label = x402SummaryLabel(
    parseX402SignalState(
      (signals ?? []).map((s) => ({
        ...s,
        value: s.value ?? "",
        payloadJson: s.payloadJson ?? null,
        lastCheckedAt: s.lastCheckedAt ? new Date(s.lastCheckedAt) : null,
      })),
    ),
  );
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="h-8 -ml-2 text-muted-foreground" asChild>
        <Link href="/dashboard">
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          All agents
        </Link>
      </Button>
      <section className="ui-overview-summary overflow-hidden rounded-xl">
      <div className="ui-overview-identity flex flex-col gap-4 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar image={agentImage} name={agentName} size="md" className="rounded-xl shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">{agentName}</h1>
              <span className="inline-flex items-center rounded-full border border-border bg-[#272727] px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Monetize
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Paid listings, x402 readiness, and payment wallet setup.
            </p>
          </div>
        </div>
        {publicProfileHref ? (
          <Button variant="outline" size="sm" className="shrink-0 w-full sm:w-auto" asChild>
            <Link href={publicProfileHref} target="_blank">
              View public profile
              <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        ) : null}
      </div>
      {!loading && payload ? (
        <div className="ui-overview-metrics grid grid-cols-2 sm:grid-cols-4">
          {[
            { label: "Listings", value: paidCount },
            { label: "Live", value: publishedCount },
            { label: "Drafts", value: draftCount },
            { label: "x402", value: x402Label },
          ].map((metric) => (
            <div key={metric.label} className="ui-overview-metric px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{metric.label}</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">{metric.value}</p>
            </div>
          ))}
        </div>
      ) : null}
      </section>
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading monetization…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : payload ? (
        <DashboardMonetizationPanel
          agentDbId={agentDbId}
          paidServices={payload.paidServices}
          signals={signals}
          trustedWallets={trustedWallets}
          readiness={resource.data?.readiness ?? null}
          publicProfileHref={publicProfileHref}
          onUpdated={resource.refresh}
          embedded
        />
      ) : null}
    </div>
  );
}
