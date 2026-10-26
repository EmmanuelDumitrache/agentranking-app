"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
};

export function DashboardTradeTerminalPage({ children }: Props) {
  return (
    <div className="ui-terminal-page flex h-full min-h-0 flex-1 flex-col p-3 sm:p-4">
      <div
        className={cn(
          "ui-terminal-window flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#3a3a3c]",
          "shadow-[0_24px_80px_rgba(0,0,0,0.55)]",
        )}
      >
        {children}
      </div>
    </div>
  );
}
