import { BadgeCheck } from "lucide-react";
import type { ScannerTableLayout } from "@/lib/scanner-table-layout";
export function ScannerStatusCell({
  verified,
  layout: _layout,
}: {
  readonly verified: boolean;
  readonly layout: ScannerTableLayout;
}) {
  if (!verified) {
    return <span className="scanner-status-empty" aria-hidden>—</span>;
  }
  return (
    <span className="scanner-status-icon" title="Verified">
      <BadgeCheck className="scanner-verified-badge h-4 w-4" aria-hidden />
    </span>
  );
}