"use client";

import type { ReactNode } from "react";
import type { ArCardBinOption } from "@/lib/agent-payments/providers/card/ar-card-bins";
import { CardNetworkMark } from "@/components/treasury/card-network-marks";
import { cn } from "@/lib/utils";

function formatUsdAmount(dollars: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    dollars,
  );
}

function StatTile({
  label,
  children,
  accent = false,
}: {
  label: string;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-transparent px-3 py-2.5 shadow-sm shadow-black/5">
      <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/90">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1.5 text-sm font-medium leading-tight text-foreground",
          accent && "font-semibold text-foreground",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

type Props = {
  option: ArCardBinOption;
  className?: string;
};

export function ArCardBinStatGrid({ option, className }: Props) {
  return (
    <dl className={cn("mt-4 grid grid-cols-2 gap-2", className)}>
      <StatTile label="Network">
        <span className="flex items-center gap-2 capitalize">
          <CardNetworkMark network={option.network} className="h-[18px]" />
          <span className="text-xs text-muted-foreground">{option.network}</span>
        </span>
      </StatTile>
      <StatTile label="BIN">
        <span className="font-mono text-[13px] tracking-wide">{option.bin}</span>
      </StatTile>
      <StatTile label="Annual limit" accent>
        {formatUsdAmount(option.annualLimitUsd)}
      </StatTile>
      <StatTile label="Top-ups">Unlimited</StatTile>
    </dl>
  );
}
