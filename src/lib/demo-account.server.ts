import { prisma } from "@/lib/db";
import { countNativeAgentsForProfile } from "@/lib/app-account-summary";
import { createNativeAgentRankingAgent } from "@/lib/dashboard/native-agent";
import { DEMO_ACCOUNT_EMAIL } from "@/lib/demo-mode";

/** Fictional agents that give the shared demo account a populated workspace. */
const DEMO_WORKSPACE_AGENTS = [
  {
    name: "Atlas Research (Demo)",
    description:
      "Demo agent that summarises on-chain activity for ERC-8004 agents and drafts weekly research notes.",
    persona: "Concise analyst. Cites sources and flags uncertainty.",
    tags: ["research", "analytics", "erc-8004"],
  },
  {
    name: "Ledger Scout (Demo)",
    description:
      "Demo agent that watches registry events across Base, Ethereum and BNB Smart Chain and reports new listings.",
    persona: "Alert, factual and brief.",
    tags: ["monitoring", "alerts", "multichain"],
  },
] as const;

/**
 * Give the demo account its sample agents on first sign-in. Agents are created
 * through the normal native-agent path, so their custodial wallets are fresh,
 * unfunded keys encrypted with the demo deployment's own throwaway key.
 */
export async function ensureDemoWorkspace(): Promise<void> {
  const profile = await prisma.userProfile.findUnique({
    where: { email: DEMO_ACCOUNT_EMAIL },
    select: { id: true, walletAddress: true, solanaWallet: true },
  });
  if (!profile) return;
  if ((await countNativeAgentsForProfile(profile.id)) > 0) return;
  for (const agent of DEMO_WORKSPACE_AGENTS) {
    await createNativeAgentRankingAgent(profile, { ...agent, tags: [...agent.tags] });
  }
}
