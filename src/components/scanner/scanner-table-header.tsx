"use client";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SCANNER_FULL_HEADER_LABELS,
  SCANNER_LATEST_HEADER_LABELS,
} from "@/components/scanner/scanner-grid";
import type { ScannerSortColumn, ScannerViewMode } from "@/components/scanner/types";
export type ScannerHeaderProps = {
  readonly mode: ScannerViewMode;
  readonly sortColumn?: ScannerSortColumn;
  readonly sortDirection?: "asc" | "desc";
  readonly onSort?: (column: ScannerSortColumn) => void;
};
function SortIcon({
  column,
  sortColumn,
  sortDirection,
}: {
  readonly column: ScannerSortColumn;
  readonly sortColumn?: ScannerSortColumn;
  readonly sortDirection?: "asc" | "desc";
}) {
  if (sortColumn !== column) {
    return <ChevronDown className="scanner-th-sort-icon scanner-th-sort-icon--idle" aria-hidden />;
  }
  return sortDirection === "asc" ? (
    <ChevronUp className="scanner-th-sort-icon" aria-hidden />
  ) : (
    <ChevronDown className="scanner-th-sort-icon" aria-hidden />
  );
}
export function ScannerHeader({ mode, sortColumn, sortDirection, onSort }: ScannerHeaderProps) {
  const labels = mode === "latest" ? SCANNER_LATEST_HEADER_LABELS : SCANNER_FULL_HEADER_LABELS;
  return (
    <div className="scanner-grid-header" role="row">
      {labels.map((col) => {
        const sortable = Boolean(col.sortKey && onSort);
        const alignClass = col.align === "right" ? "scanner-grid-header-cell--right" : undefined;
        if (sortable && col.sortKey) {
          const key = col.sortKey;
          return (
            <button
              key={col.id}
              type="button"
              className={cn("scanner-grid-header-cell scanner-grid-header-cell--sortable", alignClass)}
              onClick={() => onSort?.(key)}
            >
              <span>{col.label}</span>
              <SortIcon column={key} sortColumn={sortColumn} sortDirection={sortDirection} />
            </button>
          );
        }
        return (
          <div key={col.id} className={cn("scanner-grid-header-cell", alignClass)}>
            {col.label}
          </div>
        );
      })}
    </div>
  );
}
export {
  SCANNER_FULL_HEADER_LABELS,
  SCANNER_LATEST_HEADER_LABELS,
} from "@/components/scanner/scanner-grid";