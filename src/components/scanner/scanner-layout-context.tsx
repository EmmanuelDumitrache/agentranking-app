"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useScannerTableLayout } from "@/hooks/use-scanner-table-layout";
import type { ScannerTableLayout } from "@/lib/scanner-table-layout";
type ScannerLayoutContextValue = {
  layout: ScannerTableLayout;
  setLayout: (layout: ScannerTableLayout) => void;
  ready: boolean;
};
const ScannerLayoutContext = createContext<ScannerLayoutContextValue | null>(null);
export function ScannerLayoutProvider({
  defaultLayout = "single",
  children,
}: {
  readonly defaultLayout?: ScannerTableLayout;
  readonly children: ReactNode;
}) {
  const value = useScannerTableLayout(defaultLayout);
  return <ScannerLayoutContext.Provider value={value}>{children}</ScannerLayoutContext.Provider>;
}
export function useScannerLayoutContext(): ScannerLayoutContextValue {
  const ctx = useContext(ScannerLayoutContext);
  if (!ctx) {
    throw new Error("useScannerLayoutContext must be used within ScannerLayoutProvider");
  }
  return ctx;
}
export function useScannerLayoutContextOptional(): ScannerLayoutContextValue | null {
  return useContext(ScannerLayoutContext);
}