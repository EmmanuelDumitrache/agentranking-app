"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { cn } from "@/lib/utils";
/** Robinhood Chain mark for wallet / launch UI pills. */
export function RobinhoodChainIcon({ className }: { readonly className?: string }) {
  return (
    <RuntimeImage
      src="/brandkit/protocol-logos/robinhood.com.png"
      alt=""
      className={cn("h-3.5 w-3.5 shrink-0 rounded-sm object-cover", className)}
      aria-hidden
    />
  );
}
