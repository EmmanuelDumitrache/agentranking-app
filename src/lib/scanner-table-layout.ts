export type ScannerTableLayout = "single" | "multi";
export const SCANNER_TABLE_LAYOUT_STORAGE_KEY = "agentranking-table-layout";
export const SCANNER_TABLE_LAYOUT_EVENT = "agentranking-table-layout-change";
export function readScannerTableLayout(): ScannerTableLayout | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(SCANNER_TABLE_LAYOUT_STORAGE_KEY);
  if (stored === "single" || stored === "multi") return stored;
  return null;
}
export function writeScannerTableLayout(layout: ScannerTableLayout): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SCANNER_TABLE_LAYOUT_STORAGE_KEY, layout);
  window.dispatchEvent(new Event(SCANNER_TABLE_LAYOUT_EVENT));
}
/** Discovery / market pages default to grid cards. */
export const SCANNER_LAYOUT_DEFAULT_DISCOVERY: ScannerTableLayout = "multi";
