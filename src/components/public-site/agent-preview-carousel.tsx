"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { useRouter } from "next/navigation";
import type { PublicAgentPreview } from "@/lib/public-site/types";
import { PublicAgentPreviewCard } from "@/components/public-site/agent-preview-card";
import type { ArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-types";
import { useArLiveFeedEvent } from "@/hooks/use-ar-live-feed-event";
import { cn } from "@/lib/utils";
const FLASH_MS = 900;
type Props = {
  readonly agents: readonly PublicAgentPreview[];
};
function sortAgentsNewestFirst(
  agents: readonly PublicAgentPreview[],
): PublicAgentPreview[] {
  return [...agents].sort((a, b) => {
    const aListed = Date.parse(a.listedAt ?? "") || 0;
    const bListed = Date.parse(b.listedAt ?? "") || 0;
    if (bListed !== aListed) return bListed - aListed;
    return b.id - a.id;
  });
}
function agentMatchesFeedEvent(
  agent: PublicAgentPreview,
  event: ArLiveFeedEvent,
): boolean {
  if (event.kind !== "agent_launch") return false;
  if (event.id === `agent:native:${agent.id}`) return true;
  if (event.href && agent.profileHref === event.href) return true;
  if (event.name && event.name.trim().toLowerCase() === agent.name.trim().toLowerCase()) {
    return true;
  }
  const href = event.href?.toLowerCase() ?? "";
  if (href && agent.profileHref.toLowerCase() === href) return true;
  return false;
}
function bumpAgentToFront(
  agents: readonly PublicAgentPreview[],
  agentId: number,
): PublicAgentPreview[] {
  const index = agents.findIndex((agent) => agent.id === agentId);
  if (index < 0) return [...agents];
  if (index === 0) return [...agents];
  const next = [...agents];
  const [item] = next.splice(index, 1);
  if (!item) return [...agents];
  next.unshift(item);
  return next;
}
export function AgentPreviewCarousel({ agents: initialAgents }: Props) {
  const router = useRouter();
  const sourceKey = initialAgents
    .map((agent) => `${agent.id}:${agent.listedAt ?? ""}`)
    .join("|");
  const [agents, setAgents] = useSourceDraft(sourceKey, sortAgentsNewestFirst(initialAgents));
  const [flashId, setFlashId] = useState<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashAgent = useCallback((agentId: number) => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setFlashId(agentId);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      setFlashId((current) => (current === agentId ? null : current));
    }, FLASH_MS);
  }, []);
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);
  const handleFeedEvent = useCallback(
    (event: ArLiveFeedEvent) => {
      if (event.kind !== "agent_launch") return;
      router.refresh();
      setAgents((previous) => {
        const match = previous.find((agent) => agentMatchesFeedEvent(agent, event));
        if (!match) return previous;
        flashAgent(match.id);
        return bumpAgentToFront(previous, match.id);
      });
    },
    [flashAgent, router, setAgents],
  );
  useArLiveFeedEvent(["agent_launch"] as const, handleFeedEvent);
  return (
    <div className="token-preview-strip overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory]">
      <div className="flex min-w-0 items-stretch gap-3">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={cn(
              "token-preview-strip__item w-[min(260px,78vw)] shrink-0 [scroll-snap-align:start] sm:w-[min(280px,42vw)] lg:w-[min(300px,24rem)]",
              flashId === agent.id && "token-preview-strip__item--flash",
            )}
          >
            <PublicAgentPreviewCard agent={agent} />
          </div>
        ))}
      </div>
    </div>
  );
}
