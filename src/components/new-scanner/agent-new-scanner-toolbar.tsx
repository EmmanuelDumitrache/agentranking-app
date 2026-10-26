"use client";
import { RefreshCcw, Rocket } from "lucide-react";
import { ScannerLayoutToggle } from "@/components/scanner/scanner-layout-toggle";
import { useScannerLayoutContextOptional } from "@/components/scanner/scanner-layout-context";
import { NEW_SCANNER_LIVE_POLL_SECONDS } from "@/lib/new-agent-scanner/constants";
import { cn } from "@/lib/utils";
export function AgentNewScannerToolbar({
  isRefreshing,
  onRefresh,
}: {
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
}) {
  const layoutCtx = useScannerLayoutContextOptional();
  return (
    <div className="new-scanner-toolbar new-scanner-toolbar--compact">
      <div className="new-scanner-toolbar-title-row">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="new-scanner-toolbar-icon" aria-hidden>
            <Rocket className="h-3.5 w-3.5" />
          </span>
          <h1 className="new-scanner-page-title">New Agents</h1>
          <span
            className="new-scanner-live-badge"
            title={`Refreshes every ${NEW_SCANNER_LIVE_POLL_SECONDS}s when this tab is visible`}
          >
            <span className="new-scanner-live-dot" aria-hidden />
            Live · {NEW_SCANNER_LIVE_POLL_SECONDS}s
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {layoutCtx ? (
            <ScannerLayoutToggle layout={layoutCtx.layout} onLayoutChange={layoutCtx.setLayout} />
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="new-scanner-refresh-btn"
            aria-label="Refresh new agents"
          >
            <RefreshCcw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
          </button>
        </div>
      </div>
    </div>
  );
}