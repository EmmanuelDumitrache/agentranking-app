import type { AgentListBadgeId } from "@/lib/agent-list-status-badges";
import { cn } from "@/lib/utils";
const SCANNER_PILL_BASE =
  "inline-flex h-[19px] max-w-full items-center truncate rounded-[4px] border px-1.5 text-[11px] font-medium leading-none";
function pillClassForBadge(id: AgentListBadgeId): string {
  switch (id) {
    case "verified":
      return "border-[color-mix(in_oklab,var(--ar-verify-gold)_28%,transparent)] bg-[color-mix(in_oklab,var(--ar-verify-gold)_8%,transparent)] text-[var(--ar-verify-gold)]";
    case "x402":
    case "mcp":
    case "sap":
    case "metaplex":
    case "metaplexRegistered":
    case "metaplexBoundToken":
      return "border-[color-mix(in_oklab,#e4e4e4_8%,transparent)] bg-[color-mix(in_oklab,#e4e4e4_3%,transparent)] text-[var(--ar-text-secondary)]";
    case "chainVerified":
    case "identityRegistered":
    case "claimed":
      return "border-[color-mix(in_oklab,#e4e4e4_8%,transparent)] bg-transparent text-[var(--ar-text-tertiary)]";
    case "sponsored":
      return "border-[color-mix(in_oklab,#e4e4e4_10%,transparent)] bg-[color-mix(in_oklab,#e4e4e4_4%,transparent)] text-[var(--ar-text-secondary)]";
  }
  return "border-[color-mix(in_oklab,#e4e4e4_8%,transparent)] bg-transparent text-[var(--ar-text-muted)]";
}
export function ScannerPill({
  id,
  label,
  className,
}: {
  readonly id?: AgentListBadgeId;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        SCANNER_PILL_BASE,
        id ? pillClassForBadge(id) : "border-[color-mix(in_oklab,#e4e4e4_8%,transparent)] bg-transparent text-[var(--ar-text-tertiary)]",
        className,
      )}
    >
      {label}
    </span>
  );
}