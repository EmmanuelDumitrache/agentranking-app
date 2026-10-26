import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { mergeSapSeoFields } from "@/lib/agent-sap-merge";
export interface AgentSeoData {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  description: string;
  image: string;
  score: number;
  isVerified: boolean;
  isPremiumVerified: boolean;
  binanceCompatible?: boolean;
  x402Support?: boolean;
  verifiedWallet: string;
  activityUpdatedAt: Date | null;
  perfWinRate: number | null;
  activeWinRate30d: number | null;
  chain: {
    name: string;
    shortName: string;
  };
  services?: { name: string }[];
}
/**
 * Lean server-side fetch used for metadata/SEO rendering.
 * Keeps the query light by selecting only fields needed for SEO tags.
 */
export const getAgentSeoData = cache(
  async (chainId: number, agentId: number): Promise<AgentSeoData | null> => {
    if (!Number.isFinite(chainId) || !Number.isFinite(agentId)) return null;
    const agent = await prisma.agent.findUnique({
          where: { agentId_chainId: { agentId, chainId }, isActive: true },
          select: {
            id: true,
            agentId: true,
            chainId: true,
            name: true,
            description: true,
            image: true,
            score: true,
            isVerified: true,
            isPremiumVerified: true,
            binanceCompatible: true,
            x402Support: true,
            verifiedWallet: true,
            activityUpdatedAt: true,
            perfWinRate: true,
            activeWinRate30d: true,
            sapVerified: true,
            sapX402Endpoint: true,
            sapStats: true,
            agentURI: true,
            chain: {
              select: {
                name: true,
                shortName: true,
              },
            },
            services: {
              select: { name: true },
            },
          },
        });
    if (!agent) return null;
    const merged = mergeSapSeoFields({
      sapVerified: agent.sapVerified === true,
      name: agent.name,
      description: agent.description,
      agentURI: agent.agentURI ?? "",
      x402Support: agent.x402Support === true,
      sapX402Endpoint: agent.sapX402Endpoint,
      sapStats: agent.sapStats,
    });
    return {
      ...agent,
      name: merged.name,
      description: merged.description,
      x402Support: merged.x402Support,
      services: agent.services.map((s) => ({ name: s.name })),
    };
  }
);
