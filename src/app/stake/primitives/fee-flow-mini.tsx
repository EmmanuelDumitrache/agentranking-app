import { ArrowDown } from "lucide-react";
import { FEE_FLOW_MINI_STEPS } from "@/lib/staking-dashboard-copy";
import { cn } from "@/lib/utils";
export function FeeFlowMini({ className }: { readonly className?: string }) {
  return (
    <div className={cn("ar-stake-fee-flow", className)}>
      <p className="ar-public-label">Fee flow</p>
      <ul className="mt-3 space-y-0">
        {FEE_FLOW_MINI_STEPS.map((step, i) => (
          <li key={step}>
            <div className="flex items-center gap-2 py-1.5">
              <span className="ar-stake-fee-flow-step" aria-hidden>
                {i + 1}
              </span>
              <span className="text-[12px] font-medium text-[var(--ar-text-primary)]">{step}</span>
            </div>
            {i < FEE_FLOW_MINI_STEPS.length - 1 ? (
              <ArrowDown className="ml-2.5 h-3 w-3 text-[var(--ar-text-muted)]" aria-hidden />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
