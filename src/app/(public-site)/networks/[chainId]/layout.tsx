import type { Metadata } from "next";
import type { ReactNode } from "react";
import { prisma } from "@/lib/db";
import { getChainByChainId } from "@/lib/chains";
import { absoluteUrl } from "@/lib/site-url";
import { getChainHubKeywords } from "@/lib/seo-keywords";
import { hreflangLanguages } from "@/lib/seo-defaults";
import { parsePublicChainId } from "@/lib/agent-public-identity";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
type Props = { params: Promise<{ chainId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chainId } = await params;
  const chainIdNum = parsePublicChainId(chainId);
  if (chainIdNum == null) {
    return {
      title: "Network | AgentRanking",
      description: "On-chain AI agents on this network.",
    };
  }
  const publicWhere = await extendAgentWhereIndexable({ chainId: chainIdNum });
  const [dbChain, liveAgentCount] = await Promise.all([
    prisma.chain.findUnique({
      where: { chainId: chainIdNum },
      select: { name: true, shortName: true },
    }),
    prisma.agent.count({ where: publicWhere }),
  ]);
  const config = getChainByChainId(chainIdNum);
  const chainName = dbChain?.name ?? config?.name ?? `Chain ${chainId}`;
  const agentCount = liveAgentCount;
  const title = `AI Agents on ${chainName} | AgentRanking`;
  const description =
    agentCount > 0
      ? `Discover ${agentCount.toLocaleString()} on-chain AI agents on ${chainName}. Browse, verify, and interact with autonomous agents. AgentRanking.`
      : `On-chain AI agents on ${chainName}. Explore the agent registry on AgentRanking.`;
  const url = absoluteUrl(`/networks/${chainIdNum}`);
  const shortName = dbChain?.shortName ?? config?.shortName;
  const keywords = getChainHubKeywords(chainName, shortName, chainIdNum);
  return {
    title,
    description,
    keywords,
    alternates: { canonical: url, languages: hreflangLanguages(url) },
    openGraph: {
      title,
      description,
      url,
      siteName: "AgentRanking",
      type: "website",
      images: [
        {
          url: absoluteUrl("/og-default.png"),
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [absoluteUrl("/og-default.png")],
    },
  };
}
export default function NetworkChainLayout({ children }: { children: ReactNode }) {
  return children;
}
