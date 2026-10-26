import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
type Props = {
  readonly children: ReactNode;
  readonly className?: string;
  readonly fullBleed?: boolean;
};
export function PublicSitePageShell({ children, className, fullBleed = false }: Props) {
  return (
    <div
      className={cn(
        "ui-page-stack",
        fullBleed && "ui-page-stack--full-bleed w-full max-w-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
