"use client";
import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
type Token = "USDC" | "AR";
export function X402PaymentTokenPreview() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<Token>("USDC");
  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => {
      setActive((t) => (t === "USDC" ? "AR" : "USDC"));
    }, 2800);
    return () => clearInterval(id);
  }, [reduceMotion]);
  return (
    <div className="mt-3 flex gap-2 flex-wrap" role="group" aria-label="Payment token preview">
      {(["USDC", "AR"] as const).map((token) => (
        <span
          key={token}
          className={cn(
            "rounded-md border px-3 py-1.5 min-h-9 inline-flex items-center text-[10px] font-medium transition-all duration-300",
            token === "USDC"
              ? active === "USDC"
                ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300 scale-105"
                : "border-border/60 bg-muted/30 text-muted-foreground"
              : active === "AR"
                ? "border-amber-500/50 bg-amber-500/20 text-amber-300 scale-105"
                : "border-border/60 bg-muted/30 text-muted-foreground",
          )}
        >
          {token}
        </span>
      ))}
    </div>
  );
}
