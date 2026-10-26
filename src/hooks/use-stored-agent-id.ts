"use client";

import { useSyncExternalStore } from "react";
import type { DashboardAgentSummary } from "@/lib/dashboard/types";
import { LAST_AGENT_STORAGE_EVENT, readStoredAgentId } from "@/lib/dashboard/active-agent";

function subscribe(onStoreChange: () => void): () => void {
  globalThis.window.addEventListener("storage", onStoreChange);
  globalThis.window.addEventListener(LAST_AGENT_STORAGE_EVENT, onStoreChange);
  return () => {
    globalThis.window.removeEventListener("storage", onStoreChange);
    globalThis.window.removeEventListener(LAST_AGENT_STORAGE_EVENT, onStoreChange);
  };
}

export function useStoredAgentId(ownedAgents: readonly DashboardAgentSummary[]): number | null {
  return useSyncExternalStore(
    subscribe,
    () => readStoredAgentId(ownedAgents),
    () => null,
  );
}
