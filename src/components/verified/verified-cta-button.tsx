import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
export function VerifiedCTAButton({
  href,
  children,
  variant = "primary",
  className,
  onClick,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly variant?: "primary" | "secondary";
  readonly className?: string;
  readonly onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "verified-cta",
        variant === "primary" ? "verified-cta--primary" : "verified-cta--secondary",
        className,
      )}
    >
      {children}
    </Link>
  );
}