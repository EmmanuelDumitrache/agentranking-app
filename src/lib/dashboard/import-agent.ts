import { prisma } from "@/lib/db";
import { buildOwnedAgentsWhere } from "@/lib/dashboard/agent-ownership";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
import type { CreateNativeAgentProfile } from "@/lib/dashboard/native-agent";
export type ResolvedImportCandidate = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  image: string;
  description: string;
  owner: string;
  listingRegistrySource: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
  tokenAddress: string;
  metaplexAgentTokenMint: string | null;
};
export type ImportAgentLookupResult =
  | { ok: true; agent: ResolvedImportCandidate }
  | { ok: false; error: string };
const agentImportSelect = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  image: true,
  description: true,
  owner: true,
  listingRegistrySource: true,
  isVerified: true,
  isPremiumVerified: true,
  tokenAddress: true,
  metaplexAgentTokenMint: true,
} as const;
function parseAgentsPath(input: string): { chainId: number; agentId: number } | null {
  const trimmed = input.trim();
  const match = trimmed.match(/\/agents\/(\d+)\/(\d+)(?:\/)?$/);
  if (!match) return null;
  const chainId = Number.parseInt(match[1], 10);
  const agentId = Number.parseInt(match[2], 10);
  if (!Number.isFinite(chainId) || !Number.isFinite(agentId)) return null;
  return { chainId, agentId };
}
export async function resolveImportCandidate(query: string): Promise<ImportAgentLookupResult> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, error: "Enter an agent URL, database id, or mint address" };
  const pathIds = parseAgentsPath(trimmed);
  if (pathIds) {
    const agent = await prisma.agent.findUnique({
      where: { agentId_chainId: pathIds },
      select: agentImportSelect,
    });
    if (!agent) return { ok: false, error: "No agent found for that profile URL" };
    return { ok: true, agent };
  }
  if (/^\d+$/.test(trimmed)) {
    const dbId = Number.parseInt(trimmed, 10);
    const agent = await prisma.agent.findUnique({
      where: { id: dbId },
      select: agentImportSelect,
    });
    if (!agent) return { ok: false, error: "No agent found for that database id" };
    return { ok: true, agent };
  }
  const mint = trimmed;
  const launch = await prisma.agentLaunch.findFirst({
    where: { mint },
    select: { agentId: true },
  });
  let agent =
    launch?.agentId && /^\d+$/.test(launch.agentId)
      ? await prisma.agent.findUnique({
          where: { id: Number.parseInt(launch.agentId, 10) },
          select: agentImportSelect,
        })
      : null;
  if (!agent) {
    agent = await prisma.agent.findFirst({
      where: {
        OR: [
          { tokenAddress: mint },
          { metaplexAgentTokenMint: mint },
          {
            metadata: {
              some: { key: "tokenAddress", value: { equals: mint, mode: "insensitive" } },
            },
          },
        ],
      },
      select: agentImportSelect,
    });
  }
  if (!agent) return { ok: false, error: "No indexed agent found for that mint" };
  return { ok: true, agent };
}
function walletMatchesProfile(
  agent: ResolvedImportCandidate,
  profile: CreateNativeAgentProfile,
): boolean {
  const wallets = [profile.walletAddress, profile.solanaWallet]
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean);
  if (wallets.length === 0) return false;
  const owner = agent.owner.trim().toLowerCase();
  return wallets.some((wallet) => wallet === owner);
}
async function upsertAgentMetadataKey(agentId: number, key: string, value: string): Promise<void> {
  const existing = await prisma.agentMetadata.findFirst({ where: { agentId, key } });
  if (existing) {
    await prisma.agentMetadata.update({ where: { id: existing.id }, data: { value } });
    return;
  }
  await prisma.agentMetadata.create({ data: { agentId, key, value } });
}
export async function importAgentForWorkspace(
  profile: CreateNativeAgentProfile,
  agentDbId: number,
): Promise<{ ok: true; status: "owned" | "pending_verification" } | { ok: false; error: string }> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: agentImportSelect,
  });
  if (!agent) return { ok: false, error: "Agent not found" };
  const existingClaim = await prisma.sapAgentOperatorClaim.findUnique({
    where: { agentId: agentDbId },
    select: { userProfileId: true },
  });
  if (existingClaim && existingClaim.userProfileId !== profile.id) {
    return { ok: false, error: "This agent is already claimed by another workspace owner" };
  }
  const alreadyOwned = await prisma.agent.findFirst({
    where: {
      AND: [{ id: agentDbId }, buildOwnedAgentsWhere(profile)],
    },
    select: { id: true },
  });
  if (alreadyOwned) {
    return { ok: true, status: "owned" };
  }
  const walletProof = walletMatchesProfile(agent, profile);
  const verifiedOwner = agent.isVerified || agent.isPremiumVerified;
  if (!walletProof && verifiedOwner) {
    return {
      ok: false,
      error: "Verified agents require wallet proof. Link the owner wallet on Settings first.",
    };
  }
  if (!walletProof) {
    await upsertAgentMetadataKey(agentDbId, "dashboardImportStatus", "pending_verification");
    return { ok: false, error: "Wallet proof required. Link owner wallet or complete verification." };
  }
  await prisma.sapAgentOperatorClaim.upsert({
    where: { agentId: agentDbId },
    create: {
      agentId: agentDbId,
      userProfileId: profile.id,
      solanaWallet: profile.solanaWallet?.trim() || profile.walletAddress?.trim() || "",
    },
    update: {
      userProfileId: profile.id,
      solanaWallet: profile.solanaWallet?.trim() || profile.walletAddress?.trim() || "",
    },
  });
  if (!isAgentRankingNativeAgent(agent)) {
    await upsertAgentMetadataKey(agentDbId, "dashboardImportStatus", "imported");
  }
  return { ok: true, status: "owned" };
}
