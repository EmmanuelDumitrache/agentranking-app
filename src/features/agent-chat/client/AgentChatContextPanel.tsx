"use client";
import { memo, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  Wallet,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  buildKnownChatCapabilities,
  describeKnownCapabilities,
} from "../shared/capabilities";
import type { ClientModelOption } from "../shared/contracts";
import { AgentCardSpendPanel } from "./AgentCardSpendPanel";
type AgentChatAgent = {
  id: number;
  name: string;
  description: string | null;
  image: string;
  isVerified: boolean;
};
interface Props {
  agent: AgentChatAgent;
  selectedModel?: ClientModelOption | null;
}
function AgentChatContextPanelComponent({ agent, selectedModel }: Props) {
  const walletQuery = useQuery({
    queryKey: ["agent-chat", "wallet-info", agent.id],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/dashboard/agents/${agent.id}/wallet-info`,
        { signal },
      );
      if (res.status === 400) {
        return null;
      }
      if (!res.ok) {
        throw new Error("Could not load wallet info");
      }
      return (await res.json()) as {
        publicKey: string;
        solanaNetwork?: string;
      };
    },
    staleTime: 60_000,
    retry: 1,
  });
  const capabilities = useMemo(
    () =>
      buildKnownChatCapabilities({
        verified: agent.isVerified,
        walletPublicKey: walletQuery.data?.publicKey,
        walletNetwork: walletQuery.data?.solanaNetwork ?? "solana",
        walletIsCustodial: !!walletQuery.data?.publicKey,
        modelTools: selectedModel?.capabilities.tools,
        modelWebSearch: selectedModel?.capabilities.webSearch,
        modelImages: selectedModel?.capabilities.images,
      }),
    [
      agent.isVerified,
      selectedModel?.capabilities.images,
      selectedModel?.capabilities.tools,
      selectedModel?.capabilities.webSearch,
      walletQuery.data?.publicKey,
      walletQuery.data?.solanaNetwork,
    ],
  );
  const capabilityItems = useMemo(
    () => describeKnownCapabilities(capabilities),
    [capabilities],
  );
  return (
    <div className="ui-chat-context-panel flex h-full min-h-0 flex-col overflow-hidden bg-[#0f0f0f] text-neutral-100">
      <div className="shrink-0 border-b border-[#212121] px-4 py-3 pr-12">
        <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
          Agent context
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-3">
          {agent.image ? (
            <Image
              src={agent.image}
              alt=""
              width={40}
              height={40}
              unoptimized
              className="size-10 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-full border border-[#212121] bg-[#181818]">
              <Bot aria-hidden className="size-5 text-neutral-500" />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium">{agent.name}</h3>
            {agent.isVerified && (
              <Badge
                variant="secondary"
                className="mt-1 gap-1 border border-[#212121] bg-[#181818] px-1.5 py-0 text-[10px] text-neutral-300"
              >
                <ShieldCheck aria-hidden className="size-3" />
                Verified
              </Badge>
            )}
          </div>
        </div>
        {agent.description ? (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-neutral-400">
            {agent.description}
          </p>
        ) : (
          <p className="mt-4 text-sm text-neutral-400">
            No public description has been added for this agent.
          </p>
        )}
        <div className="mt-6 space-y-3">
          <div className="flex items-center gap-2">
            <Wrench
              aria-hidden
              className="size-3.5 text-muted-foreground"
            />
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Capabilities
            </p>
          </div>
          {walletQuery.isLoading ? (
            <div
              className="space-y-2"
              aria-label="Loading capabilities"
              role="status"
            >
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : (
            <ul className="space-y-2">
              {capabilityItems.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-[#212121] bg-[#181818] px-3 py-2.5"
                >
                  <div className="flex items-start gap-2">
                    <CheckCircle2
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug">
                        {item.label}
                      </p>
                      {item.detail ? (
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {item.detail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {walletQuery.isError ? (
            <div
              className="flex items-start gap-2 rounded-md border border-[#212121] bg-[#181818] px-2.5 py-2 text-xs text-muted-foreground"
              role="alert"
            >
              <span className="min-w-0 flex-1 leading-relaxed">
                Wallet status could not be refreshed. Profile capabilities still
                apply.
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 shrink-0 gap-1 px-1.5 text-neutral-300 hover:bg-[#212121] hover:text-white"
                onClick={() => void walletQuery.refetch()}
                disabled={walletQuery.isFetching}
              >
                <RefreshCw
                  aria-hidden
                  className={cn(
                    "size-3",
                    walletQuery.isFetching &&
                      "animate-spin motion-reduce:animate-none",
                  )}
                />
                Retry
              </Button>
            </div>
          ) : null}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Chat never invents faucets, airdrops, or third-party APIs. Ask
            “what tools do you have?” for the live runtime inventory.
          </p>
        </div>
        <AgentCardSpendPanel agentDbId={agent.id} />
        <div className="mt-6 space-y-2 border-t border-[#212121] pt-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Quick links
          </p>
          <div className="flex flex-col gap-1.5">
            <Link
              href={`/dashboard/agents/${agent.id}`}
              className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-200 hover:bg-[#181818] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <Bot aria-hidden className="size-3.5 text-muted-foreground" />
              Agent overview
              <ChevronRight aria-hidden className="ml-auto size-3 opacity-50" />
            </Link>
            <Link
              href={`/dashboard/agents/${agent.id}/wallet`}
              className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-200 hover:bg-[#181818] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <Wallet aria-hidden className="size-3.5 text-muted-foreground" />
              Wallet
              <ChevronRight aria-hidden className="ml-auto size-3 opacity-50" />
            </Link>
            <Link
              href={`/dashboard/agents/${agent.id}/verify`}
              className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-200 hover:bg-[#181818] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              <ShieldCheck
                aria-hidden
                className="size-3.5 text-muted-foreground"
              />
              Verification
              <ChevronRight aria-hidden className="ml-auto size-3 opacity-50" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
export const AgentChatContextPanel = memo(AgentChatContextPanelComponent);
