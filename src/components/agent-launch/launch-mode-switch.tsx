"use client";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
const MODE_COPY =
  "Devnet launches are for testing only. Mainnet launch mode is locked until production rollout.";
type Props = {
  readonly className?: string;
};
/**
 * UI-only network mode indicator. Does not switch chains or persist selection.
 */
export function LaunchModeSwitch({ className }: Props) {
  return (
    <div className={cn("space-y-2", className)}>
      <fieldset
        className="inline-flex rounded-lg border bg-muted/40 p-1"
        aria-label="Launch network mode"
      >
        <legend className="sr-only">Launch network mode</legend>
        <button
          type="button"
          aria-pressed="true"
          disabled
          className="rounded-md bg-background px-3 py-1.5 text-sm font-medium shadow-sm"
        >
          Testnet / Devnet
        </button>
        <button
          type="button"
          aria-pressed="false"
          disabled
          className="text-muted-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium opacity-60"
          title="Mainnet launch mode is locked until production rollout"
        >
          <Lock className="size-3.5 shrink-0" aria-hidden />
          Live / Mainnet
        </button>
      </fieldset>
      <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">{MODE_COPY}</p>
    </div>
  );
}
export { MODE_COPY as LAUNCH_MODE_SWITCH_COPY };