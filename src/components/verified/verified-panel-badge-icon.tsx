import { BadgeCheck } from "lucide-react";
export function VerifiedPanelBadgeIcon() {
  return (
    <span className="verified-panel-badge-icon" aria-hidden>
      <BadgeCheck className="verified-panel-badge-icon-tick" strokeWidth={2.25} />
    </span>
  );
}