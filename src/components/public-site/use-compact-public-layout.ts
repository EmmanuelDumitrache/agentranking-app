"use client";
import { useMediaQuery } from "@/hooks/use-media-query";
/** Narrow viewports: skip heavy hero animations and URL typing. */
export function useCompactPublicLayout(): boolean {
  return useMediaQuery("(max-width: 640px)");
}
