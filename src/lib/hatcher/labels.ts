import { HATCHER_INDEXED_BADGE_LABEL, HATCHER_VERIFIED_BADGE_LABEL } from "@/lib/hatcher/config";
import type { HatcherMetadata } from "@/lib/hatcher/types";
export function hatcherBadgeLabel(meta: HatcherMetadata | null | undefined): string {
  if (!meta) return HATCHER_INDEXED_BADGE_LABEL;
  if (meta.badge === "verified" || meta.source === "partner_feed") {
    return HATCHER_VERIFIED_BADGE_LABEL;
  }
  return HATCHER_INDEXED_BADGE_LABEL;
}
