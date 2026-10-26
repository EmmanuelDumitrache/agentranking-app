"use client";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  scannerPageButtonLabel,
  scannerShowingLabel,
} from "@/lib/scanner-pagination";
export function ScannerPagination({
  page,
  perPage,
  total,
  totalPages,
  onPageChange,
  isPageLoading = false,
  entityLabel = "agents",
  entityButtonLabel = "Agents",
  className,
}: {
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
  readonly isPageLoading?: boolean;
  readonly entityLabel?: string;
  readonly entityButtonLabel?: string;
  readonly className?: string;
}) {
  const canPrev = page > 1;
  const canNext = page < totalPages;
  if (total <= 0) return null;
  return (
    <div className={cn("scanner-pagination", className)} aria-busy={isPageLoading}>
      <p className="scanner-pagination-status">
        {isPageLoading ? (
          <Loader2
            className="scanner-pagination-spinner h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        ) : null}
        <span>{scannerShowingLabel(page, perPage, total, entityLabel)}</span>
      </p>
      <div className="scanner-pagination-actions">
        {canPrev ? (
          <button
            type="button"
            className="scanner-pagination-btn"
            disabled={isPageLoading}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{scannerPageButtonLabel(page - 1, perPage, total, entityButtonLabel)}</span>
          </button>
        ) : null}
        {canNext ? (
          <button
            type="button"
            className="scanner-pagination-btn"
            disabled={isPageLoading}
            onClick={() => onPageChange(page + 1)}
          >
            <span>{scannerPageButtonLabel(page + 1, perPage, total, entityButtonLabel)}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}