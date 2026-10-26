import "server-only";
import { prisma } from "@/lib/db";
import { toAgentUrlSlug } from "@/lib/agent-public-url";
import { parseAgentFromUrl } from "@/lib/agent-url-parse";

async function loadCurrentAgentForProfileUrl(linkUrl: string) {
  const parsed = parseAgentFromUrl(linkUrl);
  if (!parsed) return null;
  const row = await prisma.agent.findUnique({
    where: {
      agentId_chainId: {
        agentId: parsed.agentId,
        chainId: parsed.chainId,
      },
    },
    select: { id: true, agentId: true, chainId: true, name: true },
  });
  if (!row || toAgentUrlSlug(row.name) !== parsed.slug) return null;
  return row;
}

/** Resolve only a current, canonical Agent profile URL to its database id. */
export async function resolveAgentDbIdFromLinkUrl(linkUrl: string): Promise<number | null> {
  const row = await loadCurrentAgentForProfileUrl(linkUrl.trim());
  return row?.id ?? null;
}

/** Resolve only a current, canonical Agent profile URL to its on-chain identity. */
export async function resolveOnChainIdsFromProfileUrl(
  url: string,
): Promise<{ chainId: number; agentId: number } | null> {
  const row = await loadCurrentAgentForProfileUrl(url.trim());
  return row ? { chainId: row.chainId, agentId: row.agentId } : null;
}
