import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getChainHubSeoContent } from "@/lib/chain-hub-seo";
import { buildFaqPageStructuredData } from "@/lib/seo-faq-jsonld";
import { getChainByChainId } from "@/lib/chains";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { AgentListChainCell } from "@/components/agents/agent-list-chain-cell";
import { dedupeAgentListByCluster } from "@/lib/agent-chain-list-dedupe";
import { ServiceBadge } from "@/components/shared/service-badge";
import { ScoreDisplay } from "@/components/shared/score-display";
import { BadgeCheck, AlertTriangle, ArrowLeft } from "lucide-react";
import { agentPublicPath } from "@/lib/agent-public-url";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
import { parsePublicChainId } from "@/lib/agent-public-identity";
type Props = { params: Promise<{ chainId: string }> };
async function getChainAndAgents(chainId: number) {
  const chain = await prisma.chain.findUnique({
    where: { chainId },
    select: {
      name: true,
      shortName: true,
      icon: true,
      color: true,
      agentCount: true,
      isActive: true,
    },
  });
  if (!chain) return null;
  const publicWhere = await extendAgentWhereIndexable({ chainId });
  const [liveAgentCount, agents] = await Promise.all([
    prisma.agent.count({ where: publicWhere }),
    prisma.agent.findMany({
      where: publicWhere,
      select: {
        id: true,
        agentId: true,
        chainId: true,
        clusterKey: true,
        agentURI: true,
        sapVerified: true,
        sapX402Endpoint: true,
        name: true,
        image: true,
        score: true,
        rank: true,
        stars: true,
        totalFeedback: true,
        isVerified: true,
        isPremiumVerified: true,
        hasDuplicateName: true,
        x402Support: true,
        chain: { select: { shortName: true, color: true, icon: true } },
        services: { select: { id: true, name: true, endpoint: true } },
        metadata: { select: { key: true, value: true } },
      },
      orderBy: [{ isPremiumVerified: "desc" }, { isVerified: "desc" }, { score: "desc" }],
      take: 100,
    }),
  ]);
  type ChainAgentRow = (typeof agents)[number];
  const withCluster = await dedupeAgentListByCluster<ChainAgentRow>(agents);
  return {
    chain: { ...chain, agentCount: liveAgentCount },
    agents: withCluster.map((a) => ({
      ...a,
      hasDuplicateName: a.deploymentCount > 1 ? false : a.hasDuplicateName,
    })),
  };
}
export default async function NetworkChainPage({ params }: Props) {
  const { chainId } = await params;
  const chainIdNum = parsePublicChainId(chainId);
  if (chainIdNum == null) notFound();
  const data = await getChainAndAgents(chainIdNum);
  if (!data) notFound();
  const { chain, agents } = data;
  const config = getChainByChainId(chainIdNum);
  const hubSeo = getChainHubSeoContent(chainIdNum, chain.name);
  return (
    <div className="p-4 md:p-6">
      {hubSeo.faqs.length > 0 ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(buildFaqPageStructuredData(hubSeo.faqs)),
          }}
        />
      ) : null}
      <div className="mb-6">
        <Link
          href="/networks"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Networks
        </Link>
        <h1 className="text-2xl font-bold">AI Agents on {chain.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {chain.agentCount.toLocaleString()} ERC-8004 agents on {chain.name}. Browse and verify before interacting.
        </p>
      </div>
      <section
        className="mb-6 rounded-xl border border-border/80 bg-card/30 px-3 py-3 md:px-4 md:py-4"
        aria-labelledby="chain-hub-about"
      >
        <h2 id="chain-hub-about" className="text-sm font-semibold text-foreground mb-2">
          About this network on AgentRanking
        </h2>
        <div className="space-y-2 text-xs md:text-sm text-muted-foreground leading-relaxed">
          <p>{hubSeo.introParagraphs[0]}</p>
          <p>{hubSeo.introParagraphs[1]}</p>
        </div>
        <div className="mt-4 border-t border-border/60 pt-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide mb-2">
            Common questions
          </h3>
          <ul className="space-y-1">
            {hubSeo.faqs.map((item) => (
              <li key={item.question}>
                <details className="group rounded-lg border border-border/50 bg-background/40 px-2 py-1.5">
                  <summary className="cursor-pointer text-xs md:text-sm font-medium text-foreground list-none flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                    <span>{item.question}</span>
                    <span className="text-muted-foreground text-[10px] shrink-0 group-open:rotate-180 transition-transform">
                      ▾
                    </span>
                  </summary>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed pl-0.5 pb-1">{item.answer}</p>
                </details>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {agents.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          <p>No agents on this chain yet. Check back after the next sync.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-2.5 px-4 font-medium">Agent</th>
                  <th className="text-left py-2.5 px-3 font-medium">Protocols</th>
                  <th className="text-center py-2.5 px-3 font-medium">Score</th>
                  <th className="text-center py-2.5 px-3 font-medium">Feedback</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const goldStyle =
                    agent.isPremiumVerified || agent.isVerified
                      ? {
                          background: "linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b)",
                          WebkitBackgroundClip: "text" as const,
                          WebkitTextFillColor: "transparent" as const,
                          fontWeight: 700,
                        }
                      : undefined;
                  return (
                    <tr
                      key={`${agent.chainId}-${agent.agentId}`}
                      className="border-b border-border hover:bg-muted/20 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <Link
                          href={agentPublicPath(agent)}
                          className="flex items-center gap-3 min-w-0"
                        >
                          <AgentAvatar image={agent.image || null} name={agent.name} size="sm" />
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-medium truncate" style={goldStyle}>
                              {agent.name}
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <AgentListChainCell
                                chainId={agent.chainId}
                                chain={{
                                  shortName: chain.shortName,
                                  color: config?.color ?? chain.color,
                                  icon: config?.icon ?? chain.icon,
                                }}
                                deploymentCount={agent.deploymentCount}
                                chainLogoStack={agent.chainLogoStack}
                              />
                              {(agent.isPremiumVerified || agent.isVerified) && (
                                <span className="inline-flex items-center gap-0.5 text-amber-500 text-[10px]">
                                  <BadgeCheck className="h-3 w-3" /> Verified
                                </span>
                              )}
                              {agent.hasDuplicateName && !agent.isPremiumVerified && (
                                <span className="inline-flex items-center gap-0.5 text-amber-500 text-[10px]">
                                  <AlertTriangle className="h-3 w-3" /> Duplicate
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex gap-1 flex-wrap">
                          {agent.services.slice(0, 3).map((s) => (
                            <ServiceBadge key={s.id} name={s.name} />
                          ))}
                          {agent.services.length > 3 && (
                            <span className="text-xs text-muted-foreground">+{agent.services.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <ScoreDisplay score={agent.score} showTrend={false} />
                      </td>
                      <td className="py-3 px-3 text-center text-muted-foreground">
                        {agent.totalFeedback}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {chain.agentCount > 100 && (
            <div className="border-t border-border py-2 px-4 text-center text-xs text-muted-foreground">
              Showing top 100 of {chain.agentCount.toLocaleString()}.{" "}
              <Link href={`/agents?chain=${chainIdNum}`} className="text-primary hover:underline">
                View all
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
