import "server-only";

import { ServiceType, buildRegistrationFileJson } from "8004-solana";
import { prisma } from "@/lib/db";
import { agentPublicUrl } from "@/lib/agent-public-url";
import { classifyDashboardServiceType } from "@/lib/dashboard/service-type";
import { resolveUploadPublicUrl } from "@/lib/public-media-url";

const CANONICAL_PUBLIC_ORIGIN = "https://agentranking.io";

export function canonicalAgentProfileUrl(agent: {
  chainId: number;
  agentId: number;
  name: string;
}): string {
  return agentPublicUrl(CANONICAL_PUBLIC_ORIGIN, agent);
}

export function canonicalRegistrationFileUrl(agent: {
  chainId: number;
  agentId: number;
}): string {
  return `${CANONICAL_PUBLIC_ORIGIN}/api/agents/${agent.chainId}/${agent.agentId}/registration`;
}

function toServiceType(kind: ReturnType<typeof classifyDashboardServiceType>): ServiceType | null {
  if (kind === "mcp") return ServiceType.MCP;
  if (kind === "a2a") return ServiceType.A2A;
  return null;
}

export async function buildAgentRegistrationFileJson(agentDbId: number): Promise<Record<string, unknown> | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId, isActive: true },
    select: {
      name: true,
      description: true,
      image: true,
      chainId: true,
      agentId: true,
      x402Support: true,
      sapX402Endpoint: true,
      agentWallet: { select: { publicKey: true } },
      metadata: { select: { key: true, value: true } },
      services: { select: { name: true, endpoint: true } },
      paidServices: {
        where: { isPublished: true },
        select: { title: true, endpointUrl: true, serviceType: true },
      },
    },
  });
  if (!agent) return null;

  const profileUrl = canonicalAgentProfileUrl(agent);
  const image = resolveUploadPublicUrl(agent.image);
  const capabilities = agent.metadata
    .filter((row) => row.key === "capability" && row.value.trim())
    .map((row) => row.value.trim());
  const services: Array<{ type: ServiceType; value: string }> = [];
  const seen = new Set<string>();

  const pushService = (type: ServiceType, value: string) => {
    const endpoint = value.trim();
    if (!endpoint) return;
    const key = `${type}:${endpoint}`;
    if (seen.has(key)) return;
    seen.add(key);
    services.push({ type, value: endpoint });
  };

  for (const service of agent.services) {
    const mapped = toServiceType(
      classifyDashboardServiceType({ name: service.name, endpoint: service.endpoint }),
    );
    if (mapped) pushService(mapped, service.endpoint);
  }
  for (const paid of agent.paidServices) {
    const mapped = toServiceType(
      classifyDashboardServiceType({
        name: paid.title,
        endpoint: paid.endpointUrl,
        x402Detected: paid.serviceType.toLowerCase().includes("x402"),
      }),
    );
    if (mapped) pushService(mapped, paid.endpointUrl);
  }
  if (agent.sapX402Endpoint?.trim()) {
    pushService(ServiceType.MCP, agent.sapX402Endpoint.trim());
  }
  const wallet = agent.agentWallet?.publicKey?.trim();
  if (wallet) {
    pushService(ServiceType.WALLET, wallet);
  }

  const json = buildRegistrationFileJson({
    name: agent.name.trim() || `Agent ${agent.agentId}`,
    description: agent.description.trim() || `AgentRanking agent ${agent.name}`.trim(),
    image: image || undefined,
    services,
    active: true,
    x402Support: Boolean(agent.x402Support || agent.sapX402Endpoint),
  });

  return {
    ...json,
    agentURI: profileUrl,
    metadata: {
      origin: "agentranking",
      profile: profileUrl,
      capabilities,
    },
  };
}
