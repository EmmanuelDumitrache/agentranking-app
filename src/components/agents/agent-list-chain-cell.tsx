"use client";
import { ChainBadge } from "@/components/shared/chain-badge";
import { getChainByChainId } from "@/lib/chains";
import {
  AgentChainLogoStack,
  enrichChainLogoStack,
} from "@/components/agents/agent-chain-logo-stack";
import type { ChainLogoStackItem } from "@/lib/agent-chain-cluster";
export type AgentRowChainProps = {
  readonly chainId: number;
  readonly chain: { shortName: string; color: string; icon?: string };
  readonly deploymentCount?: number;
  readonly chainLogoStack?: ReadonlyArray<ChainLogoStackItem>;
  readonly icon?: string;
  readonly iconOnly?: boolean;
  readonly size?: "sm" | "md";
};
type Props = AgentRowChainProps;
export function AgentListChainCell({
  chainId,
  chain,
  chainLogoStack = [],
  icon,
  iconOnly = true,
  size,
}: Props) {
  const stack = enrichChainLogoStack(chainLogoStack);
  if (stack.length > 1) {
    return <AgentChainLogoStack items={stack} size={size === "md" ? "sm" : "xs"} />;
  }
  const chainIcon = icon ?? getChainByChainId(chainId)?.icon ?? chain.icon ?? "";
  return (
    <ChainBadge
      name={chain.shortName}
      color={chain.color}
      icon={chainIcon}
      iconOnly={iconOnly}
      size={size}
    />
  );
}