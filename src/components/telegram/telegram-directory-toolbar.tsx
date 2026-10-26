"use client";
import { RefreshCcw, Plus } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TELEGRAM_BLUE } from "@/lib/telegram/constants";
function TelegramIcon({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L8.17 13.404l-2.97-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.007.13.988.155z" />
    </svg>
  );
}
export function TelegramDirectoryToolbar({
  total,
  isRefreshing,
  onRefresh,
}: {
  readonly total: number | null;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
}) {
  return (
    <div className="telegram-directory-toolbar">
      <div className="telegram-directory-toolbar-row">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="telegram-directory-icon" aria-hidden>
            <TelegramIcon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <h1 className="telegram-directory-title">Telegram Bots</h1>
            {total != null ? (
              <p className="telegram-directory-meta">{total.toLocaleString()} bots indexed</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="telegram-directory-refresh"
            aria-label="Refresh Telegram bots"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
          </button>
          <Link href="/create/telegram-bot" className="telegram-directory-cta">
            <Plus className="h-3.5 w-3.5" />
            Submit bot
          </Link>
        </div>
      </div>
      <p className="telegram-directory-subcopy">
        Standalone bots and managed spawn flows — separate from the on-chain agent directory.
      </p>
    </div>
  );
}
export { TELEGRAM_BLUE };