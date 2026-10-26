import { prisma } from "@/lib/db";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
export interface AgentListConfig {
  sort: "score" | "feedback" | "created";
  limit: number;
  chainId?: number;
  x402?: boolean;
}
export interface ArticleAgent {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  slug: string;
  profilePath: string;
  description: string;
  image: string;
  score: number;
  totalFeedback: number;
  stars: number;
  x402Support: boolean;
  scoreWallet?: number;
  isVerified: boolean;
  chain: { shortName: string; color: string; icon: string };
}
export async function getAgentsForArticle(config: AgentListConfig): Promise<ArticleAgent[]> {
  const { sort, limit, chainId, x402 } = config;
  const where: { chainId?: number; x402Support?: boolean; score?: { gte: number } } = {};
  if (chainId != null) where.chainId = chainId;
  if (x402 === true) where.x402Support = true;
  if (sort === "score" || sort === "feedback") where.score = { gte: 0 };
  let orderBy: { score?: "desc"; totalFeedback?: "desc"; createdAt?: "desc" };
  if (sort === "score") orderBy = { score: "desc" };
  else if (sort === "feedback") orderBy = { totalFeedback: "desc" };
  else orderBy = { createdAt: "desc" };
  const agents = await prisma.agent.findMany({
    where,
    include: { chain: true },
    orderBy,
    take: limit,
  });
  return agents.map((a) => ({
    id: a.id,
    agentId: a.agentId,
    chainId: a.chainId,
    name: a.name,
    slug: toAgentUrlSlug(a.name),
    profilePath: agentPublicPath(a),
    description: a.description,
    image: a.image,
    score: a.score,
    totalFeedback: a.totalFeedback,
    stars: a.stars,
    x402Support: a.x402Support,
    scoreWallet: a.scoreWallet,
    isVerified: a.isVerified,
    chain: {
      shortName: a.chain.shortName,
      color: a.chain.color,
      icon: a.chain.icon,
    },
  }));
}
