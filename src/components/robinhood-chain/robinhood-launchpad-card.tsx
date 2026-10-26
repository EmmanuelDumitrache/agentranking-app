import { RuntimeImage } from "@/components/shared/runtime-image";
import { cn } from "@/lib/utils";

/** Compact provider chip — selects inline Robinhood launch on the launchpad. */
export function RobinhoodChainProviderCard({
  selected,
  onSelect,
}: {
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "ui-launch-chip inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
        selected
          ? "border-foreground/25 bg-[#212121] text-foreground"
          : "border-[#303030] bg-[#181818] text-muted-foreground hover:border-[#474747] hover:bg-[#212121]",
      )}
    >
      <RuntimeImage
        src="/brandkit/protocol-logos/robinhood.com.png"
        alt=""
        className="h-4 w-4 shrink-0 rounded object-contain"
        aria-hidden
      />
      Quiver
    </button>
  );
}
