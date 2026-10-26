"use client";
import { useEffect } from "react";
import {
  clearChunkReloadAttempt,
  isChunkLoadErrorMessage,
  reloadForChunkError,
  shouldAttemptChunkReload,
} from "@/lib/chunk-load-error";
/**
 * After a VPS deploy, browsers may still hold HTML that references old content-hashed
 * chunks. Recover once with a hard reload instead of leaving users on the error boundary.
 */
export function ChunkLoadRecovery() {
  useEffect(() => {
    // Webpack HMR often emits "Failed to fetch dynamically imported module" in dev — auto-reload loops.
    if (process.env.NODE_ENV === "development") return;
    const timer = globalThis.setTimeout(() => clearChunkReloadAttempt(), 30_000);
    const onFailure = (message: string) => {
      if (!isChunkLoadErrorMessage(message) || !shouldAttemptChunkReload()) return;
      console.warn("[ChunkLoadRecovery] stale chunk detected, reloading once:", message);
      reloadForChunkError();
    };
    const messageFromRejection = (reason: unknown): string => {
      if (typeof reason === "string") return reason;
      if (reason instanceof Error) return reason.message;
      return "";
    };
    const onError = (event: ErrorEvent) => {
      const msg = event.message || event.error?.message || "";
      onFailure(msg);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      onFailure(messageFromRejection(event.reason));
    };
    globalThis.addEventListener("error", onError);
    globalThis.addEventListener("unhandledrejection", onRejection);
    return () => {
      globalThis.clearTimeout(timer);
      globalThis.removeEventListener("error", onError);
      globalThis.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}