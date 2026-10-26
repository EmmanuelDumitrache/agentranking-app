import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
type Props = {
  readonly children: ReactNode;
  readonly className?: string;
};
/**
 * Agent Launch pages use readable body type (16px) instead of the dashboard’s
 * dense 13px dashboard tokens, and fill the main column without letterboxing.
 */
export function AgentLaunchPageShell({ children, className }: Props) {
  return (
    <div
      className={cn(
        "agent-launch-page mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-6 px-4 py-8 text-base leading-normal sm:px-6 sm:py-10",
        className,
      )}
    >
      {children}
    </div>
  );
}
