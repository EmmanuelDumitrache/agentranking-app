"use client";
import { useCallback, useSyncExternalStore } from "react";
import {
  readScannerTableLayout,
  writeScannerTableLayout,
  SCANNER_TABLE_LAYOUT_EVENT,
  type ScannerTableLayout,
} from "@/lib/scanner-table-layout";
import { useHydrated } from "@/hooks/use-hydrated";

function subscribe(onStoreChange: () => void): () => void {
  globalThis.window.addEventListener("storage", onStoreChange);
  globalThis.window.addEventListener(SCANNER_TABLE_LAYOUT_EVENT, onStoreChange);
  return () => {
    globalThis.window.removeEventListener("storage", onStoreChange);
    globalThis.window.removeEventListener(SCANNER_TABLE_LAYOUT_EVENT, onStoreChange);
  };
}

export function useScannerTableLayout(defaultLayout: ScannerTableLayout = "single") {
  const layout = useSyncExternalStore(
    subscribe,
    () => readScannerTableLayout() ?? defaultLayout,
    () => defaultLayout,
  );
  const ready = useHydrated();
  const setLayout = useCallback((next: ScannerTableLayout) => {
    writeScannerTableLayout(next);
  }, []);
  return { layout, setLayout, ready };
}
