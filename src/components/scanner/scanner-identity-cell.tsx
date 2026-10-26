import { BadgeCheck } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import type { ScannerTableLayout } from "@/lib/scanner-table-layout";
import type { ScannerAgentRow } from "@/components/scanner/types";
export function ScannerIdentityCell({
  row,
  layout,
}: {
  readonly row: ScannerAgentRow;
  readonly layout: ScannerTableLayout;
}) {
  const avatarClass =
    layout === "single"
      ? "scanner-agent-avatar scanner-agent-avatar--single"
      : "scanner-agent-avatar scanner-agent-avatar--multi";
  return (
    <div
      className={
        layout === "single"
          ? "scanner-identity scanner-identity--single min-w-0"
          : "scanner-identity scanner-identity--multi min-w-0"
      }
    >
      <AgentAvatar
        image={row.image}
        name={row.name}
        size="sm"
        className={avatarClass}
        loading="lazy"
      />
      <span className="scanner-agent-name inline-flex min-w-0 items-center gap-1.5 leading-tight">
        <span className="truncate">{row.name}</span>
        {row.isVerified ? (
          <BadgeCheck className="scanner-verified-badge h-3 w-3 shrink-0" aria-hidden />
        ) : null}
      </span>
    </div>
  );
}