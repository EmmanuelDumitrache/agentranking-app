"use client";
import { Loader2 } from "lucide-react";
import { LockedSupplyLockCard } from "@/components/public-site/locked-supply-lock-card";
import { sortedArTokenLocks } from "@/lib/ar-token-locks";
import { useStreamflowLocks } from "@/lib/use-streamflow-locks";
import type { StreamflowLocksLivePayload } from "@/lib/streamflow-vesting-types";
export function ArTokenLockRegistry({
  layout = "grid",
  initialLiveData,
}: Readonly<{
  layout?: "grid" | "stack";
  initialLiveData?: StreamflowLocksLivePayload | null;
}>) {
  const { mergedLocks, isLoading } = useStreamflowLocks(initialLiveData);
  const locks =
    mergedLocks.length > 0
      ? mergedLocks
      : sortedArTokenLocks().map((lock) => ({ ...lock, live: null }));
  if (locks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
        <p className="text-base font-semibold text-foreground">No locks published yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          When new Streamflow vesting contracts go live, they will appear here with live balances.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-12 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
          Reading Streamflow contracts on Solana…
        </div>
      ) : (
        <ul
          className={
            layout === "stack"
              ? "grid list-none gap-5 p-0"
              : "grid list-none gap-5 p-0 lg:grid-cols-2"
          }
        >
          {locks.map((lock) => (
            <li key={lock.id} className="min-w-0">
              <LockedSupplyLockCard lock={lock} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
