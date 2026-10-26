"use client";
import { Wallet } from "lucide-react";
import { getPaymentLabel } from "@/lib/agent-utils";
interface PaymentPillProps {
  readonly agent: {
    x402Support?: boolean;
    scoreWallet?: number;
    chainId: number;
  };
  readonly className?: string;
  /** If true, show text label instead of icon-only (e.g. in agent detail header) */
  readonly showLabel?: boolean;
}
export function PaymentPill({ agent, className, showLabel = false }: PaymentPillProps) {
  const label = getPaymentLabel(agent);
  if (!label) return null;
  if (showLabel) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-green-500/15 text-green-400 ${className ?? ""}`}
      >
        <Wallet className="h-3 w-3" />
        {label}
      </span>
    );
  }
  return (
    <span
      title={`Payments: ${label}`}
      className={`inline-flex items-center justify-center rounded-full p-1 bg-green-500/15 text-green-400 cursor-default ${className ?? ""}`}
    >
      <Wallet className="h-3 w-3" />
    </span>
  );
}