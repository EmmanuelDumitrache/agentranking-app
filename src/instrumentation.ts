import { ensureDevNextAuthUrl } from "@/lib/nextauth-url";
/**
 * RainbowKit / WalletConnect touch IndexedDB when connector bundles initialize.
 * That runs during Next.js RSC/SSR in Node, where `indexedDB` is undefined unless polyfilled.
 * (Symptom: /docs and other routes fail in dev with ReferenceError: indexedDB is not defined.)
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    ensureDevNextAuthUrl();
    await import("fake-indexeddb/auto");
  }
}