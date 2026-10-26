import { BadgeCheck } from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import type { NewAgentScannerRow } from "@/lib/new-agent-scanner/types";
/** Single-line agent cell: avatar + name. */
export function AgentNewIdentityCell({ row }: { readonly row: NewAgentScannerRow }) {
  return (
    <div className="new-scanner-identity new-scanner-identity--single min-w-0">
      <AgentAvatar
        image={row.image}
        name={row.name}
        size="sm"
        className="new-scanner-avatar new-scanner-avatar--single shrink-0"
        loading="lazy"
      />
      <span className="new-scanner-agent-name truncate">{row.name}</span>
      {row.isPremiumVerified ? (
        <BadgeCheck className="h-3 w-3 shrink-0 text-[var(--ar-success)]" aria-label="Verified" />
      ) : null}
    </div>
  );
}