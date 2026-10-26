"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { phantomFriendlyLocalUrl, phantomUnfriendlyHostLabel } from "@/lib/phantom-localhost-hint";
type Props = {
  readonly className?: string;
};
/** Shown when Phantom cannot run on a non-loopback local development host. */
export function PhantomDevHostBanner({ className }: Props) {
  const hydrated = useHydrated();
  const localUrl = hydrated ? phantomFriendlyLocalUrl() : null;
  const hostLabel = hydrated ? phantomUnfriendlyHostLabel() : null;
  if (!localUrl || !hostLabel) return null;
  return (
    <div
      className={
        className ??
        "rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100/90 space-y-2"
      }
    >
      <p>
        Phantom cannot connect on <span className="font-mono">{hostLabel}</span>. Open the same page on
        plain <span className="font-mono">localhost</span> to connect your wallet.
      </p>
      <Button size="sm" variant="outline" className="w-full border-amber-500/40" asChild>
        <Link href={localUrl}>Open {localUrl}</Link>
      </Button>
    </div>
  );
}
