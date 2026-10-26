import type { Prisma } from "@/generated/prisma/client";
import { homeArScore, type HomeDiscoveryAgent } from "@/lib/home-discovery-display";
export type ProfileLinkContext = {
  id: number;
  walletAddress: string | null;
  solanaWallet?: string | null;
};
/** Prisma filter for agents linked to a single profile (dashboard ownership rules). */
export function linkedAgentsWhereForProfile(
  profile: ProfileLinkContext,
): Prisma.AgentWhereInput {
  const or: Prisma.AgentWhereInput[] = [];
  if (profile.id > 0) {
    or.push({ sapOperatorClaim: { userProfileId: profile.id } });
  }
  const w = profile.walletAddress?.trim();
  if (w) {
    const isEvm = /^0x[0-9a-fA-F]{40}$/.test(w);
    const normalized = isEvm ? w.toLowerCase() : w;
    or.push(
      isEvm
        ? { owner: { equals: normalized, mode: "insensitive" } }
        : { owner: normalized },
      {
        AND: [
          { verifiedWallet: { not: "" } },
          isEvm
            ? { verifiedWallet: { equals: normalized, mode: "insensitive" } }
            : { verifiedWallet: normalized },
        ],
      },
    );
  }
  const sol = profile.solanaWallet?.trim();
  if (sol) {
    or.push(
      { sapOwnerWallet: sol },
      { owner: sol },
    );
  }
  if (or.length === 0) return { id: -1 };
  return { OR: or };
}
/** Batch fetch filter: agents linked to any profile in the set. */
export function linkedAgentsWhereForProfiles(
  profiles: readonly ProfileLinkContext[],
): Prisma.AgentWhereInput | null {
  if (profiles.length === 0) return null;
  const profileIds = profiles.map((p) => p.id);
  const or: Prisma.AgentWhereInput[] = [{ sapOperatorClaim: { userProfileId: { in: profileIds } } }];
  const evmWallets = [...new Set(
    profiles
      .map((p) => p.walletAddress?.trim() ?? "")
      .filter((wallet) => /^0x[0-9a-fA-F]{40}$/.test(wallet))
      .map((wallet) => wallet.toLowerCase()),
  )];
  if (evmWallets.length > 0) {
    or.push(
      { owner: { in: evmWallets, mode: "insensitive" } },
      {
        AND: [
          { verifiedWallet: { not: "" } },
          { verifiedWallet: { in: evmWallets, mode: "insensitive" } },
        ],
      },
    );
  }
  const exactWallets = [...new Set(
    profiles.flatMap((p) => {
      const wallet = p.walletAddress?.trim() ?? "";
      const solana = p.solanaWallet?.trim() ?? "";
      return [
        /^0x[0-9a-fA-F]{40}$/.test(wallet) ? "" : wallet,
        solana,
      ].filter(Boolean);
    }),
  )];
  if (exactWallets.length > 0) {
    or.push(
      { owner: { in: exactWallets } },
      { verifiedWallet: { in: exactWallets } },
      { sapOwnerWallet: { in: exactWallets } },
    );
  }
  return { OR: or };
}
export type LinkedAgentRow = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  image: string | null;
  rank: number;
  score: number;
  agentRankScore: number;
  protocolTrustScore: number;
  totalFeedback: number;
  isActive: boolean;
  isVerified: boolean;
  isPremiumVerified: boolean;
  x402Support: boolean;
  sapVerified: boolean;
  lastActiveAt: Date | null;
  scoreMetadata: number;
  scoreServices: number;
  owner: string;
  verifiedWallet: string;
  sapOwnerWallet: string | null;
  sapOperatorClaim: { userProfileId: number } | null;
  services: Array<{ name: string }>;
  chain: { shortName: string; color: string; icon: string };
};
function sameWallet(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left || !right) return false;
  const leftEvm = /^0x[0-9a-fA-F]{40}$/.test(left);
  const rightEvm = /^0x[0-9a-fA-F]{40}$/.test(right);
  return leftEvm && rightEvm
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
/** Assign a fetched agent to the first matching profile id (deterministic by profile id asc). */
export function profileIdsLinkedToAgent(
  agent: LinkedAgentRow,
  profiles: readonly ProfileLinkContext[],
): number[] {
  const matched: number[] = [];
  const claimId = agent.sapOperatorClaim?.userProfileId;
  for (const p of profiles) {
    if (claimId === p.id) {
      matched.push(p.id);
      continue;
    }
    if (sameWallet(agent.owner, p.walletAddress) || sameWallet(agent.verifiedWallet, p.walletAddress)) {
      matched.push(p.id);
      continue;
    }
    if (sameWallet(agent.sapOwnerWallet, p.solanaWallet) || sameWallet(agent.owner, p.solanaWallet)) {
      matched.push(p.id);
    }
  }
  return matched;
}
export function linkedAgentRankScore(agent: LinkedAgentRow): number {
  return homeArScore({
    agentRankScore: agent.agentRankScore,
    protocolTrustScore: agent.protocolTrustScore,
  } as HomeDiscoveryAgent);
}
export function agentHasMcp(agent: LinkedAgentRow): boolean {
  return agent.services.some((s) => s.name.toUpperCase() === "MCP");
}
export function agentIsComplete(agent: LinkedAgentRow): boolean {
  return (
    agent.isActive &&
    agent.scoreMetadata >= 25 &&
    (agent.scoreServices >= 20 || agent.services.length > 0)
  );
}
