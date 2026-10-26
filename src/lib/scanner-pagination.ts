export const HOME_SCANNER_PAGE_SIZE = 100;
export type ScannerPageRange = {
  start: number;
  end: number;
};
/** 1-based inclusive range for the current page. */
export function scannerPageRange(
  page: number,
  perPage: number,
  total: number,
): ScannerPageRange {
  if (total <= 0 || page < 1) return { start: 0, end: 0 };
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);
  return { start, end };
}
/** Button label e.g. "Agents 101–200". */
export function scannerPageButtonLabel(
  targetPage: number,
  perPage: number,
  total: number,
  entityLabel = "Agents",
): string {
  const { start, end } = scannerPageRange(targetPage, perPage, total);
  if (start <= 0) return entityLabel;
  return `${entityLabel} ${start.toLocaleString("en-US")}–${end.toLocaleString("en-US")}`;
}
export function scannerShowingLabel(
  page: number,
  perPage: number,
  total: number,
  entityLabel = "agents",
): string {
  const { start, end } = scannerPageRange(page, perPage, total);
  if (total <= 0) return `Showing ${entityLabel} 0`;
  return `Showing ${entityLabel} ${start.toLocaleString("en-US")}–${end.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;
}