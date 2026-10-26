import "server-only";
import { prisma } from "@/lib/db";
import { listAgentSignals } from "@/lib/signals/store";
import { appendMedusaPassportTrustTile } from "@/lib/medusa/trust-tile";
import { buildTrustSummaryTiles } from "@/lib/signals/derive";
import type { DerivedSignal } from "@/lib/signals/types";
import { mergeOfficialLinksForEditor } from "@/lib/dashboard/official-links";
import { parseVersionManifest, VERSION_MANIFEST_KEY } from "@/lib/agent-version-manifest";
export const dashboardAgentDetailSelect = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  image: true,
  description: true,
  archetype: true,
  tokenAddress: true,
  protocolTrustScore: true,
  score: true,
  scoreWallet: true,
  isVerified: true,
  isPremiumVerified: true,
  isVerifiedRevenue: true,
  sapVerified: true,
  x402Support: true,
  publicVerificationStatus: true,
  owner: true,
  verifiedWallet: true,
  services: { select: { id: true, name: true, endpoint: true, version: true } },
  metadata: { select: { key: true, value: true } },
  officialLinks: { select: { lockedByVerifiedOwner: true } },
  paidServices: {
    select: { isPublished: true },
    orderBy: { sortOrder: "asc" as const },
  },
  githubConnections: { orderBy: { createdAt: "desc" as const }, take: 1 },
} as const;
/** Dashboard agent page payload — read-only trust (no derive/sync on load). */
export async function loadDashboardAgentDetail(agentDbId: number) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: dashboardAgentDetailSelect,
  });
  if (!agent) return null;
  const signals = (await listAgentSignals(agentDbId)) as DerivedSignal[];
  return {
    agent,
    trust: {
      signals,
      tiles: appendMedusaPassportTrustTile(
        buildTrustSummaryTiles(signals),
        agent.metadata,
      ),
    },
  };
}
export async function loadDashboardVersionManifest(agentDbId: number) {
  const row = await prisma.agentMetadata.findFirst({
    where: { agentId: agentDbId, key: VERSION_MANIFEST_KEY },
    select: { value: true },
  });
  return parseVersionManifest(row?.value ?? null);
}
export async function loadDashboardAgentEditorState(agentDbId: number) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      metadata: { select: { key: true, value: true } },
      services: { select: { name: true, endpoint: true } },
      officialLinks: {
        orderBy: { linkType: "asc" },
        select: {
          linkType: true,
          url: true,
          lockedByVerifiedOwner: true,
        },
      },
    },
  });
  if (!agent) return null;
  return {
    links: mergeOfficialLinksForEditor(
      agent.officialLinks,
      agent.metadata,
      agent.services,
    ),
    savedLinkTypes: agent.officialLinks.map((row) => row.linkType),
    versionManifest: parseVersionManifest(
      agent.metadata.find((row) => row.key === VERSION_MANIFEST_KEY)?.value ?? null,
    ),
  };
}
export async function loadDashboardAgentEditorLinks(agentDbId: number) {
  const state = await loadDashboardAgentEditorState(agentDbId);
  if (!state) return null;
  return {
    links: state.links,
    savedLinkTypes: state.savedLinkTypes,
  };
}
