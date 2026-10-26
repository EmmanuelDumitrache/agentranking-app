import "server-only";
import { prisma } from "@/lib/db";
import { createNativeAgentRankingAgent } from "@/lib/dashboard/native-agent";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { agentLaunchLinkageForCreate } from "@/lib/agent-launch/agent-db-id";
import { validateMintPubkey } from "@/lib/agent-launch/validation";
import { normalizeUserMediaUrl } from "@/lib/public-media-url";
import { loadAdminCreatorDetail } from "@/lib/admin-creators-data";
async function loadCreatorAccount(accountId: string) {
  return prisma.appAccount.findUnique({
    where: { id: accountId },
    include: {
      userProfile: {
        select: {
          id: true,
          walletAddress: true,
          solanaWallet: true,
        },
      },
      accountWallet: { select: { publicKey: true } },
      agents: { select: { id: true } },
    },
  });
}
function resolveCreatorWallet(account: NonNullable<Awaited<ReturnType<typeof loadCreatorAccount>>>): string {
  return (
    account.accountWallet?.publicKey?.trim() ||
    account.userProfile.solanaWallet?.trim() ||
    account.userProfile.walletAddress?.trim() ||
    ""
  );
}
export async function adminCreateCreatorAgent(
  accountId: string,
  input: { name: string; description?: string; image?: string },
) {
  const account = await loadCreatorAccount(accountId);
  if (!account) return { ok: false as const, status: 404, error: "Creator not found" };
  const name = input.name.trim();
  if (!name) return { ok: false as const, status: 400, error: "Agent name is required" };
  try {
    const agent = await createNativeAgentRankingAgent(
      {
        id: account.userProfile.id,
        walletAddress: account.userProfile.walletAddress,
        solanaWallet: account.userProfile.solanaWallet,
      },
      {
        name,
        description: input.description,
        image: input.image,
      },
    );
    const creator = await loadAdminCreatorDetail(accountId);
    return { ok: true as const, agent, creator };
  } catch (e) {
    return {
      ok: false as const,
      status: 400,
      error: Error.isError(e) ? e.message : "Failed to create agent",
    };
  }
}
export async function adminCreateCreatorLaunch(
  accountId: string,
  input: {
    mint: string;
    agentDbId?: number | null;
    tokenName?: string;
    tokenSymbol?: string;
    tokenImageUrl?: string;
    launchStatus?: string;
  },
) {
  const account = await loadCreatorAccount(accountId);
  if (!account) return { ok: false as const, status: 404, error: "Creator not found" };
  const mint = input.mint.trim();
  const mintError = validateMintPubkey(mint);
  if (mintError) return { ok: false as const, status: 400, error: mintError };
  const ownedAgentIds = new Set(account.agents.map((a) => a.id));
  const agentDbId = input.agentDbId ?? null;
  if (agentDbId != null && !ownedAgentIds.has(agentDbId)) {
    return { ok: false as const, status: 400, error: "Agent does not belong to this creator" };
  }
  let tokenImageUrl = "";
  if (input.tokenImageUrl?.trim()) {
    try {
      tokenImageUrl = normalizeUserMediaUrl(input.tokenImageUrl, "Token image");
    } catch (e) {
      return {
        ok: false as const,
        status: 400,
        error: Error.isError(e) ? e.message : "Invalid token image URL",
      };
    }
  }
  const tokenName = input.tokenName?.trim() || null;
  const tokenSymbol = input.tokenSymbol?.trim() || null;
  const launchStatus = input.launchStatus?.trim() || "indexed";
  const creatorWallet = resolveCreatorWallet(account);
  const config = getAgentLaunchConfig();
  const existing = await prisma.agentLaunch.findUnique({ where: { mint } });
  try {
    if (existing) {
      const data: Record<string, unknown> = {
        launchStatus,
      };
      if (tokenName) data.tokenName = tokenName;
      if (tokenSymbol) data.tokenSymbol = tokenSymbol;
      if (tokenImageUrl) data.tokenImageUrl = tokenImageUrl;
      if (creatorWallet) data.creatorWallet = creatorWallet;
      if (agentDbId != null) {
        await prisma.agentLaunch.update({
          where: { id: existing.id },
          data: {
            ...data,
            agentId: String(agentDbId),
            linkedAgent: { connect: { id: agentDbId } },
          },
        });
      } else {
        await prisma.agentLaunch.update({
          where: { id: existing.id },
          data,
        });
      }
    } else {
      const linkage = agentDbId != null ? agentLaunchLinkageForCreate(String(agentDbId)) : { agentId: null };
      await prisma.agentLaunch.create({
        data: {
          ...linkage,
          mint,
          creatorWallet: creatorWallet || null,
          network: config.network,
          arTreasuryWallet: config.treasury,
          creationFeeLamports: config.creationFeeLamports,
          creatorShareBps: config.creatorShareBps,
          arShareBps: config.arShareBps,
          tokenName,
          tokenSymbol,
          tokenImageUrl: tokenImageUrl || null,
          launchStatus,
          feeSharingStatus: "active",
          launchLifecycleStatus: "live",
        },
      });
    }
    const creator = await loadAdminCreatorDetail(accountId);
    return { ok: true as const, creator };
  } catch (e) {
    return {
      ok: false as const,
      status: 500,
      error: Error.isError(e) ? e.message : "Failed to save token launch",
    };
  }
}