"use client";
import { useState, useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  isWhatsNewUnread,
  WHATS_NEW_ENTRIES,
  WHATS_NEW_LATEST_ID,
  WHATS_NEW_SEEN_STORAGE_KEY,
} from "@/content/whats-new";
import { cn } from "@/lib/utils";
const WHATS_NEW_STORAGE_EVENT = "agentranking:whats-new-storage";
let seenInCurrentSession = false;
function getUnreadSnapshot(): boolean {
  if (seenInCurrentSession) return false;
  try {
    return isWhatsNewUnread(window.localStorage.getItem(WHATS_NEW_SEEN_STORAGE_KEY));
  } catch {
    return true;
  }
}
function getServerUnreadSnapshot(): boolean {
  return false;
}
function subscribeToUnreadChanges(onStoreChange: () => void): () => void {
  function handleStorage(event: StorageEvent) {
    if (event.key === WHATS_NEW_SEEN_STORAGE_KEY) onStoreChange();
  }
  window.addEventListener("storage", handleStorage);
  window.addEventListener(WHATS_NEW_STORAGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(WHATS_NEW_STORAGE_EVENT, onStoreChange);
  };
}
export function WhatsNewButton({
  className,
  align = "center",
  side = "right",
}: {
  readonly className?: string;
  readonly align?: "start" | "center" | "end";
  readonly side?: "top" | "right" | "bottom" | "left";
}) {
  const [open, setOpen] = useState(false);
  const unread = useSyncExternalStore(
    subscribeToUnreadChanges,
    getUnreadSnapshot,
    getServerUnreadSnapshot,
  );
  function markSeen() {
    seenInCurrentSession = true;
    try {
      window.localStorage.setItem(WHATS_NEW_SEEN_STORAGE_KEY, WHATS_NEW_LATEST_ID);
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(WHATS_NEW_STORAGE_EVENT));
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) markSeen();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            className,
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          What&apos;s new
          {unread ? (
            <span
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-sky-500"
              aria-label="Unread updates"
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className="w-80 max-h-[70vh] overflow-y-auto p-0">
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-sm font-medium">What&apos;s new</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Product updates in the app</p>
        </div>
        <ul className="divide-y divide-border/60">
          {WHATS_NEW_ENTRIES.map((entry) => (
            <li key={entry.id} className="px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {entry.date}
              </p>
              <p className="mt-1 text-sm font-medium">{entry.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{entry.body}</p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
