export type VerifiedDirectoryLayout = "grid" | "list";
export const VERIFIED_DIRECTORY_LAYOUT_STORAGE_KEY = "agentranking-verified-directory-layout";
export const VERIFIED_DIRECTORY_LAYOUT_EVENT = "agentranking-verified-directory-layout-change";
export const VERIFIED_DIRECTORY_LAYOUT_DEFAULT: VerifiedDirectoryLayout = "grid";
export function readVerifiedDirectoryLayout(): VerifiedDirectoryLayout | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(VERIFIED_DIRECTORY_LAYOUT_STORAGE_KEY);
  if (stored === "grid" || stored === "list") return stored;
  return null;
}
export function writeVerifiedDirectoryLayout(layout: VerifiedDirectoryLayout): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VERIFIED_DIRECTORY_LAYOUT_STORAGE_KEY, layout);
  window.dispatchEvent(new Event(VERIFIED_DIRECTORY_LAYOUT_EVENT));
}
