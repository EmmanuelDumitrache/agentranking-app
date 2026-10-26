"use client";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

export function AppBackLink({
  className,
  children,
  fallbackHref,
}: {
  readonly className?: string;
  readonly children: React.ReactNode;
  readonly fallbackHref: string;
}) {
  const router = useRouter();
  const onBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }, [router, fallbackHref]);

  return (
    <button type="button" onClick={onBack} className={cn("ar-link app-back-link", className)}>
      {children}
    </button>
  );
}
