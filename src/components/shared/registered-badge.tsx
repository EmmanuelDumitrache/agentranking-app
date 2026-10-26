"use client";

import { Fingerprint } from "lucide-react";
import { cn } from "@/lib/utils";

/** Solana 8004 directory listing mark — pairs with VerifiedTick on agent chrome. */
export function RegisteredTick({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = { sm: "h-3.5 w-3.5", md: "h-4 w-4", lg: "h-5 w-5" };
  return (
    <span className={cn("inline-flex shrink-0", className)} title="Registered on Solana">
      <Fingerprint className={cn(sizes[size], "text-foreground")} strokeWidth={2} aria-hidden />
    </span>
  );
}
