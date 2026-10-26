"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

export type CardNetwork = "visa" | "mastercard";

export function CardVisaMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/visa-mark-white.png"
      alt=""
      aria-hidden
      width={72}
      height={23}
      className={cn("h-[22px] w-auto object-contain opacity-95", className)}
      priority={false}
    />
  );
}

export function CardMastercardMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/mastercard-mark-mono.png"
      alt=""
      aria-hidden
      width={40}
      height={24}
      className={cn("h-[22px] w-auto object-contain opacity-95", className)}
      priority={false}
    />
  );
}

export function CardNetworkMark({
  network,
  className,
}: {
  network: CardNetwork;
  className?: string;
}) {
  switch (network) {
    case "mastercard":
      return <CardMastercardMark className={className} />;
    case "visa":
      return <CardVisaMark className={className} />;
    default: {
      const _exhaustive: never = network;
      return _exhaustive;
    }
  }
}

export function KripiIssuerBadge({ className }: { className?: string }) {
  return (
    <div className={cn("inline-flex shrink-0 items-center gap-2", className)}>
      <Image
        src="/brand/kripicard-mark.png"
        alt=""
        width={20}
        height={20}
        className="size-5 rounded-md object-cover"
        unoptimized
      />
      <span className="text-[11px] leading-none text-muted-foreground">
        Issued by <span className="font-semibold text-foreground">Kripi</span>
      </span>
    </div>
  );
}
