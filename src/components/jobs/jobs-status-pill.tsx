import { cn } from "@/lib/utils";
export function JobsStatusPill({
  label,
  active = false,
  muted = false,
  className,
}: {
  readonly label: string;
  readonly active?: boolean;
  readonly muted?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "jobs-pill",
        active && "jobs-pill--active",
        muted && "jobs-pill--muted",
        className,
      )}
    >
      {label}
    </span>
  );
}