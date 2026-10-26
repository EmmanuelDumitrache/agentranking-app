"use client";
import { useQuery } from "@tanstack/react-query";
import { agentsListRetryDelay, shouldRetryAgentsListQuery } from "@/lib/agents-query-retry";
import { fetchJsonWithQuerySignal } from "@/lib/fetch-with-query-signal";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, MessageSquare } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { getChainByChainId } from "@/lib/chains";
import type { PublicNetworkSummary } from "@/lib/agent-directory/network-summaries";
export function NetworksClient({ initialNetworks }: { readonly initialNetworks: PublicNetworkSummary[] }) {
  const { data: chains, isLoading } = useQuery<PublicNetworkSummary[]>({
    queryKey: ["networks"],
    queryFn: ({ signal }) => fetchJsonWithQuerySignal("/api/networks", signal),
    initialData: initialNetworks,
    refetchOnMount: false,
    refetchInterval: 2 * 60 * 1000,
    staleTime: 30 * 1000,
    retry: shouldRetryAgentsListQuery,
    retryDelay: agentsListRetryDelay,
  });
  return (
    <div className="p-4 md:p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Supported Networks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          EVM networks use ERC-8004 identity and reputation registries; Solana listings sync from the on-chain agent registry. Indexing runs on a schedule when RPC credentials are configured.
        </p>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, index) => (
            <Card key={index} className="animate-pulse bg-card border-border">
              <CardContent className="p-6 h-48" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...(chains ?? [])].sort((a, b) => Number(b.isActive) - Number(a.isActive)).map((chain) => {
            const resolvedIcon = getChainByChainId(chain.chainId)?.icon || chain.icon;
            const isImage = resolvedIcon.startsWith("http");
            const cardContent = (
              <Card className={`bg-card border-border transition-all hover:border-primary/30 ${chain.isActive ? "cursor-pointer" : "opacity-60"}`}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    {isImage ? (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full overflow-hidden shrink-0" style={{ backgroundColor: chain.color + "20" }}>
                        <Image src={resolvedIcon} alt={chain.name} width={32} height={32} className="rounded-full" unoptimized />
                      </span>
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full text-lg shrink-0" style={{ backgroundColor: chain.color + "20", color: chain.color }}>
                        {resolvedIcon}
                      </span>
                    )}
                    <div>
                      <h3 className="font-semibold text-sm">{chain.name}</h3>
                      {!chain.isActive ? <Badge variant="secondary" className="text-[10px] mt-0.5">Coming Soon</Badge> : null}
                    </div>
                  </div>
                  {chain.isActive ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md border border-border p-2.5">
                        <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] mb-1"><Bot className="h-3 w-3" /> Agents</div>
                        <p className="text-lg font-bold">{chain.agentCount.toLocaleString()}</p>
                      </div>
                      <div className="rounded-md border border-border p-2.5">
                        <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] mb-1"><MessageSquare className="h-3 w-3" /> Feedbacks</div>
                        <p className="text-lg font-bold">{chain.feedbackCount.toLocaleString()}</p>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
            return chain.isActive ? <Link key={chain.chainId} href={`/networks/${chain.chainId}`}>{cardContent}</Link> : <div key={chain.chainId}>{cardContent}</div>;
          })}
        </div>
      )}
    </div>
  );
}
