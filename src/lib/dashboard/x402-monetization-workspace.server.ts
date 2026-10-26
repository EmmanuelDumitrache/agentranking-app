import "server-only";
import { prisma } from "@/lib/db";
import { listAgentSignals } from "@/lib/signals/store";
import { computeMonetizationReadiness } from "@/lib/dashboard/monetization-readiness";

export type DashboardPaidServiceDto = {
  id: number;
  agentId?: number;
  title: string;
  description?: string;
  serviceType?: string;
  endpointUrl?: string;
  priceUsd: number | null;
  priceLabel?: string;
  paymentWallet?: string;
  sampleResponse?: string;
  isPublished: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type DashboardMonetizationSignalDto = {
  signalType: string;
  status: string;
  value: string;
  payloadJson: unknown;
  lastCheckedAt: string | null;
};

export type DashboardMonetizationWorkspaceDto = {
  agent: {
    agentId: number;
    chainId: number;
    owner: string;
    verifiedWallet: string | null;
    paidServices: DashboardPaidServiceDto[];
  };
  signals: DashboardMonetizationSignalDto[];
  trustedWallets: string[];
  readiness: ReturnType<typeof computeMonetizationReadiness>;
};

export async function loadDashboardPaidServices(
  agentDbId: number,
): Promise<DashboardPaidServiceDto[]> {
  const rows = await prisma.agentPaidService.findMany({
    where: { agentId: agentDbId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      agentId: true,
      title: true,
      description: true,
      serviceType: true,
      endpointUrl: true,
      priceUsd: true,
      priceLabel: true,
      paymentWallet: true,
      sampleResponse: true,
      isPublished: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function loadDashboardMonetizationWorkspace(
  agentDbId: number,
): Promise<DashboardMonetizationWorkspaceDto | null> {
  const [agent, paidServices, signals, metadata] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentDbId },
      select: {
        agentId: true,
        chainId: true,
        owner: true,
        verifiedWallet: true,
      },
    }),
    loadDashboardPaidServices(agentDbId),
    listAgentSignals(agentDbId),
    prisma.agentMetadata.findMany({
      where: { agentId: agentDbId, key: "docs" },
      select: { value: true },
    }),
  ]);
  if (!agent) return null;
  const signalDtos = signals.map((signal) => ({
    signalType: signal.signalType,
    status: signal.status,
    value: signal.value,
    payloadJson: signal.payloadJson,
    lastCheckedAt: signal.lastCheckedAt?.toISOString() ?? null,
  }));
  const trustedWallets = [...new Set([agent.owner, agent.verifiedWallet]
    .map((wallet) => wallet?.trim() ?? "")
    .filter(Boolean))];
  return {
    agent: { ...agent, paidServices },
    signals: signalDtos,
    trustedWallets,
    readiness: computeMonetizationReadiness({
      signals: signalDtos,
      paidServiceCount: paidServices.length,
      hasPricing: paidServices.some((service) =>
        (service.priceUsd != null && service.priceUsd > 0) || Boolean(service.priceLabel?.trim())),
      hasDocs: metadata.some((entry) => Boolean(entry.value.trim())),
    }),
  };
}
