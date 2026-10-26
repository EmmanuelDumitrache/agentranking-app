"use client";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { ChainLogoStackItem } from "@/lib/agent-chain-cluster";
import { getChainByChainId } from "@/lib/chains";
const MAX_VISIBLE = 4;
export function enrichChainLogoStack(
  items: ReadonlyArray<ChainLogoStackItem>,
): ChainLogoStackItem[] {
  return items.map((item) => {
    const cfg = getChainByChainId(item.chainId);
    return {
      chainId: item.chainId,
      icon: item.icon?.trim() || cfg?.icon || "",
      chainShortName: item.chainShortName?.trim() || cfg?.shortName || "?",
      chainName: item.chainName?.trim() || cfg?.name || "Unknown",
    };
  });
}
type Props = {
  readonly items: ReadonlyArray<ChainLogoStackItem>;
  readonly size?: "xs" | "sm";
  readonly className?: string;
};
function ChainStackIcon({
  item,
  size,
}: {
  readonly item: ChainLogoStackItem;
  readonly size: "xs" | "sm";
}) {
  const dim = size === "xs" ? 16 : 20;
  const icon = item.icon?.trim() ?? "";
  const hasImage = icon.startsWith("http") || icon.startsWith("/");
  if (hasImage) {
    return (
      <Image
        src={icon}
        alt=""
        width={dim}
        height={dim}
        className="h-full w-full object-cover"
        unoptimized
      />
    );
  }
  const cfg = getChainByChainId(item.chainId);
  return (
    <span
      className="flex h-full w-full items-center justify-center text-[8px] font-bold"
      style={{ color: cfg?.color ?? "inherit" }}
    >
      {item.chainShortName.slice(0, 1)}
    </span>
  );
}
export function AgentChainLogoStack({ items, size = "sm", className }: Props) {
  const enriched = enrichChainLogoStack(items);
  if (enriched.length <= 1) return null;
  const visible = enriched.slice(0, MAX_VISIBLE);
  const overflow = enriched.length - visible.length;
  const dim = size === "xs" ? "h-4 w-4" : "h-5 w-5";
  const label = enriched.map((i) => i.chainName).join(", ");
  return (
    <span
      className={cn("inline-flex items-center shrink-0", className)}
      title={label}
      aria-label={`Deployed on ${enriched.length} chains: ${label}`}
    >
      <span className="inline-flex items-center">
        {visible.map((item, idx) => (
          <span
            key={item.chainId}
            className={cn(
              "relative inline-flex rounded-full ring-2 ring-background bg-muted/40 overflow-hidden",
              dim,
              idx > 0 && "-ml-1.5",
            )}
            style={{ zIndex: visible.length - idx }}
          >
            <ChainStackIcon item={item} size={size} />
          </span>
        ))}
        {overflow > 0 ? (
          <span
            className={cn(
              "-ml-1.5 relative inline-flex items-center justify-center rounded-full ring-2 ring-background bg-muted text-[9px] font-semibold text-muted-foreground",
              dim,
            )}
            style={{ zIndex: 0 }}
          >
            +{overflow}
          </span>
        ) : null}
      </span>
    </span>
  );
}