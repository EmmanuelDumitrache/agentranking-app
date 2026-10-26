"use client";
import { useCallback, useMemo } from "react";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { shortenEvmAddress } from "@/lib/evm-wallet-utils";
export type TransferTargetAgent = {
  agentDbId: number;
  name: string;
  image: string | null;
  solAddress: string | null;
  solBalanceSol: number | null;
  evmAddress: string | null;
  evmBalanceEthMainnet: number | null;
  evmBalanceEthRobinhood: number | null;
};
type ChainMode = "solana" | "evm-mainnet" | "evm-robinhood";
type Props = {
  readonly excludeAgentId?: number;
  readonly excludeAddress?: string | null;
  readonly chain: ChainMode;
  readonly selectedAgentDbId: number | null;
  readonly onSelect: (target: TransferTargetAgent | null) => void;
};
function shortenSol(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
function formatBalance(value: number | null, symbol: string): string {
  if (value == null || !Number.isFinite(value)) return `— ${symbol}`;
  if (value === 0) return `0 ${symbol}`;
  if (value < 0.0001) return `<0.0001 ${symbol}`;
  return `${value.toFixed(4).replace(/\.?0+$/, "")} ${symbol}`;
}
export function DashboardAgentWalletPicker({
  excludeAgentId,
  excludeAddress,
  chain,
  selectedAgentDbId,
  onSelect,
}: Props) {
  const loadAgents = useCallback(async (signal: AbortSignal): Promise<TransferTargetAgent[]> => {
    const qs =
      excludeAgentId != null && Number.isFinite(excludeAgentId)
        ? `?excludeAgentId=${excludeAgentId}`
        : "";
    const response = await fetch(`/api/dashboard/agents/transfer-targets${qs}`, { signal });
    const data = (await response.json()) as {
      agents?: TransferTargetAgent[];
      error?: string;
    };
    if (!response.ok) throw new Error(data.error ?? "Could not load agents");
    return data.agents ?? [];
  }, [excludeAgentId]);
  const agentsResource = useAsyncResource(
    `transfer-target-agents:${excludeAgentId ?? "all"}`,
    loadAgents,
  );
  const agents = useMemo(() => agentsResource.data ?? [], [agentsResource.data]);
  const loading = agentsResource.loading;
  const loadError = agentsResource.error?.message ?? null;
  const options = useMemo(() => {
    const exclude = excludeAddress?.trim().toLowerCase() ?? "";
    return agents.filter((agent) => {
      if (chain === "solana") {
        if (!agent.solAddress) return false;
        if (exclude && agent.solAddress.toLowerCase() === exclude) return false;
        return true;
      }
      if (!agent.evmAddress) return false;
      if (exclude && agent.evmAddress.toLowerCase() === exclude) return false;
      return true;
    });
  }, [agents, chain, excludeAddress]);
  const selected = options.find((a) => a.agentDbId === selectedAgentDbId) ?? null;
  const balanceLabel = (agent: TransferTargetAgent): string => {
    if (chain === "solana") return formatBalance(agent.solBalanceSol, "SOL");
    if (chain === "evm-mainnet") return formatBalance(agent.evmBalanceEthMainnet, "ETH");
    return formatBalance(agent.evmBalanceEthRobinhood, "ETH");
  };
  const addressLabel = (agent: TransferTargetAgent): string => {
    if (chain === "solana" && agent.solAddress) return shortenSol(agent.solAddress);
    if (agent.evmAddress) return shortenEvmAddress(agent.evmAddress);
    return "—";
  };
  if (loading) {
    return (
      <p className="text-muted-foreground text-xs">Loading your other agent wallets…</p>
    );
  }
  if (loadError) {
    return <p className="text-muted-foreground text-xs">{loadError}</p>;
  }
  if (options.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No other agent wallets available for this network.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor="agent-wallet-picker" className="text-xs font-medium">
        Or send to another agent wallet
      </Label>
      <select
        id="agent-wallet-picker"
        className={cn(
          "border-input bg-background ring-offset-background focus-visible:ring-ring",
          "flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm",
          "focus-visible:outline-none focus-visible:ring-1",
        )}
        value={selectedAgentDbId ?? ""}
        onChange={(e) => {
          const id = Number.parseInt(e.target.value, 10);
          if (!Number.isFinite(id)) {
            onSelect(null);
            return;
          }
          const next = options.find((a) => a.agentDbId === id) ?? null;
          onSelect(next);
        }}
      >
        <option value="">Select an agent…</option>
        {options.map((agent) => (
          <option key={agent.agentDbId} value={agent.agentDbId}>
            {agent.name} · {balanceLabel(agent)} · {addressLabel(agent)}
          </option>
        ))}
      </select>
      {selected ? (
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
          <p className="font-medium">{selected.name}</p>
          <p className="text-muted-foreground mt-0.5 font-mono">
            {chain === "solana" ? selected.solAddress : selected.evmAddress}
          </p>
          <p className="text-muted-foreground mt-0.5 tabular-nums">
            {balanceLabel(selected)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
