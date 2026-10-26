import { prisma } from "@/lib/db";
import type { AgentChatContext } from "../shared/types";
import { DEFAULT_AGENT_CHAT_SETTINGS } from "./repositories/settings";
import { loadActiveMemoryFactsForPrompt } from "@/features/agent-memory/server/prompt-memory";

export async function loadAgentChatContext(
  agentDbId: number,
  appAccountId: string,
  currentUserText: string,
  settingsRevisionId: string | undefined,
): Promise<AgentChatContext | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      id: true,
      name: true,
      description: true,
      archetype: true,
      image: true,
      chainId: true,
      tokenAddress: true,
      isVerified: true,
      verifiedWallet: true,
      agentWallet: { select: { publicKey: true, scope: true } },
      chatSettings: { select: { id: true, currentRevision: true } },
    },
  });
  if (!agent) return null;
  const revisionPromise = settingsRevisionId
    ? prisma.agentChatSettingsRevision.findUnique({ where: { id: settingsRevisionId } })
    : Promise.resolve(agent.chatSettings?.currentRevision ?? null);
  const [revision, memoryFacts] = await Promise.all([
    revisionPromise,
    loadActiveMemoryFactsForPrompt(agentDbId, appAccountId, currentUserText),
  ]);
  if (settingsRevisionId && (!revision || revision.settingsId !== agent.chatSettings?.id)) {
    return null;
  }
  const settings = revision ?? DEFAULT_AGENT_CHAT_SETTINGS;
  return {
    agent: {
      dbId: agent.id,
      name: agent.name,
      description: agent.description || undefined,
      archetype: agent.archetype || undefined,
      imageUrl: agent.image || undefined,
      chainId: agent.chainId.toString(),
      tokenAddress: agent.tokenAddress || undefined,
      verified: agent.isVerified,
    },
    settings: {
      enabled: settings.enabled,
      persona: settings.persona ?? undefined,
      systemInstructions: settings.systemInstructions ?? undefined,
      greeting: settings.greeting ?? undefined,
    },
    wallet: {
      publicKey: agent.agentWallet?.publicKey || agent.verifiedWallet || undefined,
      isCustodial: agent.agentWallet?.scope === "AGENT",
      network: "solana",
    },
    social: undefined,
    memoryFacts: memoryFacts.length > 0 ? memoryFacts : undefined,
  };
}
