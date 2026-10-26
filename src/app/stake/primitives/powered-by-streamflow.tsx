import Image from "next/image";
import { cn } from "@/lib/utils";
export function PoweredByStreamflow({
  className,
  variant = "card",
}: {
  readonly className?: string;
  readonly variant?: "card" | "inline";
}) {
  const inline = variant === "inline";
  return (
    <div
      className={cn(
        inline ? "ar-stake-powered-by-inline" : "ar-stake-powered-by-card",
        className,
      )}
    >
      <div className="ar-stake-powered-by-row">
        <span className="text-[12px] text-[var(--ar-text-tertiary)]">Powered by</span>
        <a
          href="https://streamflow.finance"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 font-medium text-[var(--ar-text-primary)] transition-colors hover:text-[var(--ar-text-secondary)]"
        >
          <span className="ar-stake-streamflow-logo" aria-hidden>
            <Image
              src="/partners/streamflow-mark.svg"
              alt=""
              width={inline ? 20 : 18}
              height={inline ? 20 : 18}
              className="h-[18px] w-[18px] sm:h-5 sm:w-5"
            />
          </span>
          Streamflow
        </a>
      </div>
      <p className="ar-stake-powered-by-sub">
        Staking smart contract by Streamflow Finance on Solana
      </p>
    </div>
  );
}
