import Image from "next/image";
import { cn } from "@/lib/utils";
/** Brand logo from brandkit (served as /ar-mark.png). */
const MARK_SRC = "/ar-mark.png";
export type AgentRankingWordmarkSize = "compact" | "default" | "sidebar" | "nav";
const SIZE_STYLES: Record<
  AgentRankingWordmarkSize,
  { icon: string; text: string }
> = {
  compact: {
    icon: "h-7 w-7 sm:h-8 sm:w-8",
    text: "text-sm",
  },
  nav: {
    icon: "h-10 w-10",
    text: "text-sm leading-none tracking-tight",
  },
  default: {
    icon: "h-8 w-8",
    text: "text-sm sm:text-base",
  },
  sidebar: {
    icon: "h-8 w-8 sm:h-9 sm:w-9",
    text: "text-base sm:text-lg",
  },
};
export function AgentRankingWordmark({
  variant = "wordmark",
  size = "default",
  className,
  iconClassName,
  textClassName,
  priority = false,
  src,
}: {
  readonly variant?: "wordmark" | "icon";
  readonly size?: AgentRankingWordmarkSize;
  readonly className?: string;
  readonly iconClassName?: string;
  readonly textClassName?: string;
  /** When true, the mark image loads with high priority (e.g. fixed nav / marketing hero). */
  readonly priority?: boolean;
  /** Override the default logo image source. */
  readonly src?: string;
}) {
  const markSrc = src ?? MARK_SRC;
  const preset = SIZE_STYLES[size];
  if (variant === "icon") {
    return (
      <Image
        src={markSrc}
        alt="AgentRanking"
        width={64}
        height={64}
        priority={priority}
        className={cn("h-8 w-8 object-contain", className, iconClassName)}
      />
    );
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", size === "nav" && "h-10", className)}>
      <Image
        src={markSrc}
        alt=""
        width={72}
        height={72}
        priority={priority}
        className={cn("shrink-0 object-contain", preset.icon, iconClassName)}
        aria-hidden
      />
      <span
        className={cn(
          "min-w-0 truncate leading-tight tracking-tight text-foreground",
          preset.text,
          textClassName
        )}
      >
        <span className="font-bold">Agent</span>
        <span className="font-normal">Ranking</span>
      </span>
    </span>
  );
}