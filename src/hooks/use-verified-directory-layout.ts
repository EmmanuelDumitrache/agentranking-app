"use client";
import { useCallback, useSyncExternalStore } from "react";
import {
  readVerifiedDirectoryLayout,
  VERIFIED_DIRECTORY_LAYOUT_DEFAULT,
  VERIFIED_DIRECTORY_LAYOUT_EVENT,
  writeVerifiedDirectoryLayout,
  type VerifiedDirectoryLayout,
} from "@/lib/verified-directory-layout";

function subscribe(onStoreChange: () => void): () => void {
  globalThis.window.addEventListener("storage", onStoreChange);
  globalThis.window.addEventListener(VERIFIED_DIRECTORY_LAYOUT_EVENT, onStoreChange);
  return () => {
    globalThis.window.removeEventListener("storage", onStoreChange);
    globalThis.window.removeEventListener(VERIFIED_DIRECTORY_LAYOUT_EVENT, onStoreChange);
  };
}

export function useVerifiedDirectoryLayout(
  defaultLayout: VerifiedDirectoryLayout = VERIFIED_DIRECTORY_LAYOUT_DEFAULT,
) {
  const layout = useSyncExternalStore(
    subscribe,
    () => readVerifiedDirectoryLayout() ?? defaultLayout,
    () => defaultLayout,
  );
  const setLayout = useCallback((next: VerifiedDirectoryLayout) => {
    writeVerifiedDirectoryLayout(next);
  }, []);
  return { layout, setLayout };
}
