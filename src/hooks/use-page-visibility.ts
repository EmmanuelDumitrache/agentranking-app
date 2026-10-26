"use client";
import { useSyncExternalStore } from "react";
function subscribe(onStoreChange: () => void): () => void {
  document.addEventListener("visibilitychange", onStoreChange);
  return () => document.removeEventListener("visibilitychange", onStoreChange);
}
function getSnapshot(): boolean {
  return document.visibilityState === "visible";
}
/** True when the document tab is visible (for lighter polling when backgrounded). */
export function usePageVisibility(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
