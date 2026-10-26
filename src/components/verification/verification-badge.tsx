import type { AccountVerificationLevel, AccountVerificationStatus } from "@/generated/prisma/client";
import { VerifiedTick } from "@/components/shared/verified-badge";
import { cn } from "@/lib/utils";

type Props = {
  level?: AccountVerificationLevel | "individual" | "business" | "none";
  status?: AccountVerificationStatus | "verified" | "unverified" | "pending";
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md";
};

function normalizeLevel(
  level: Props["level"],
): "individual" | "business" | "none" {
  if (!level || level === "NONE" || level === "none") return "none";
  if (level === "BUSINESS" || level === "business") return "business";
  return "individual";
}

function isVerifiedStatus(status: Props["status"]): boolean {
  if (!status) return false;
  if (status === "verified" || status === "VERIFIED") return true;
  return false;
}

export function VerificationBadge({
  level = "individual",
  status = "unverified",
  className,
  showLabel = true,
  size = "sm",
}: Props) {
  const verified = isVerifiedStatus(status);
  const normalizedLevel = normalizeLevel(level);

  if (!verified) return null;

  const label =
    normalizedLevel === "business" ? "Business verified" : "Verified";

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-foreground", className)}>
      <VerifiedTick size={size} tone="foreground" />
      {showLabel ? (
        <span
          className={cn(
            "font-medium leading-none text-muted-foreground",
            size === "md" ? "text-sm" : "text-[11px]",
          )}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
