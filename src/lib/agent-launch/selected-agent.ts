import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
export type { LaunchSelectedAgentPrefill } from "@/lib/agent-launch/selected-agent-prefill";
export {
  buildLaunchPrefillFromSelectedAgent,
  suggestTokenSymbolFromAgentName,
} from "@/lib/agent-launch/selected-agent-prefill";
export type LaunchSelectedAgentContext = {
  readonly agentDbId: number;
  readonly name: string;
  readonly description: string;
  readonly image: string;
  readonly website: string;
  readonly twitter: string;
  readonly telegram: string;
  readonly github: string;
  readonly archetype: string;
  readonly capabilityTags: string[];
  readonly services: Array<{ name: string; endpoint: string; version: string }>;
  readonly listingRegistrySource: string;
  readonly isNative: boolean;
  readonly backHref: string;
};
function metadataValue(
  rows: ReadonlyArray<{ key: string; value: string }>,
  key: string,
): string {
  return rows.find((row) => row.key === key)?.value?.trim() ?? "";
}
export async function loadLaunchSelectedAgentContext(
  agentDbId: number,
  session: Session | null,
): Promise<
  | { ok: true; agent: LaunchSelectedAgentContext }
  | { ok: false; status: 401 | 403 | 404 }
> {
  if (!Number.isFinite(agentDbId) || agentDbId <= 0) {
    return { ok: false, status: 404 };
  }
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) {
    return { ok: false, status: access.status === 401 ? 401 : 403 };
  }
  const row = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      name: true,
      description: true,
      image: true,
      agentURI: true,
      archetype: true,
      listingRegistrySource: true,
      chainId: true,
      metadata: { select: { key: true, value: true } },
      services: {
        where: { sourceKind: "dashboard" },
        select: { name: true, endpoint: true, version: true },
        orderBy: { id: "asc" },
        take: 8,
      },
    },
  });
  if (!row) return { ok: false, status: 404 };
  const website =
    metadataValue(row.metadata, "website") || row.agentURI.trim();
  const twitter = metadataValue(row.metadata, "twitter");
  const telegram = metadataValue(row.metadata, "telegram");
  const github = metadataValue(row.metadata, "github");
  const capabilityTags = row.metadata
    .filter((m) => m.key === "capability_tag" || m.key === "tag")
    .map((m) => m.value.trim().toUpperCase())
    .filter(Boolean);
  return {
    ok: true,
    agent: {
      agentDbId: row.id,
      name: row.name,
      description: row.description,
      image: row.image,
      website,
      twitter,
      telegram,
      github,
      archetype: row.archetype?.trim() ?? "",
      capabilityTags,
      services: row.services.map((service) => ({
        name: service.name,
        endpoint: service.endpoint,
        version: service.version ?? "",
      })),
      listingRegistrySource: row.listingRegistrySource,
      isNative: isAgentRankingNativeAgent(row),
      backHref: `/dashboard/agents/${row.id}`,
    },
  };
}
export async function assertLaunchOwnsAgentDbId(
  session: Session | null,
  agentIdRaw: string | null | undefined,
): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  const trimmed = agentIdRaw?.trim() ?? "";
  if (!trimmed) return { ok: true };
  const agentDbId = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(agentDbId) || String(agentDbId) !== trimmed) {
    return { ok: true };
  }
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) {
    return { ok: false, status: access.status === 401 ? 401 : 403 };
  }
  return { ok: true };
}
