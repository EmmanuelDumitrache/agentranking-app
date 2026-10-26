import type { ScannerViewMode } from "@/components/scanner/types";
export const SCANNER_GRID_TEMPLATE_FULL =
  "52px minmax(180px, 1fr) 76px 112px 96px 78px 92px 82px 70px";
export const SCANNER_GRID_TEMPLATE_LATEST =
  "52px minmax(180px, 1fr) 76px 112px 70px";
export function scannerGridTemplate(mode: ScannerViewMode): string {
  return mode === "latest" ? SCANNER_GRID_TEMPLATE_LATEST : SCANNER_GRID_TEMPLATE_FULL;
}
export const SCANNER_FULL_HEADER_LABELS = [
  { id: "rank", label: "Rank", align: "left" as const },
  { id: "agent", label: "Agent", align: "left" as const, sortKey: "name" as const },
  { id: "chain", label: "Chain", align: "left" as const, sortKey: "chain" as const },
  { id: "protocol", label: "Protocol", align: "left" as const, sortKey: "protocol" as const },
  { id: "status", label: "Status", align: "left" as const },
  { id: "ar", label: "AR Score", align: "right" as const, sortKey: "ar" as const },
  { id: "trust", label: "Trust", align: "right" as const, sortKey: "trust" as const },
  { id: "reviews", label: "Reviews", align: "right" as const, sortKey: "reviews" as const },
  { id: "age", label: "Age", align: "right" as const, sortKey: "age" as const },
];
export const SCANNER_LATEST_HEADER_LABELS = [
  { id: "rank", label: "Rank", align: "left" as const },
  { id: "agent", label: "Agent", align: "left" as const, sortKey: "name" as const },
  { id: "chain", label: "Chain", align: "left" as const, sortKey: "chain" as const },
  { id: "protocol", label: "Protocol", align: "left" as const, sortKey: "protocol" as const },
  { id: "age", label: "Age", align: "right" as const, sortKey: "age" as const },
];