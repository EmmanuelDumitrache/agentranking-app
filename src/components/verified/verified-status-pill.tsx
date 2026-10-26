import { cn } from "@/lib/utils";
export function VerifiedStatusPill({
  label,
  active = false,
  className,
}: {
  readonly label: string;
  readonly active?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "verified-status-pill",
        active && "verified-status-pill--active",
        className,
      )}
    >
      {label}
    </span>
  );
}