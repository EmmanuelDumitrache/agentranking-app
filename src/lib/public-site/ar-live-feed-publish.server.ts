import "server-only";
import { arLiveFeedHub } from "@/lib/public-site/ar-live-feed-hub.server";
import type { ArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-types";
/** Fire-and-forget publish into the live feed hub (no-op if hub fails). */
export function publishArLiveFeedEvent(event: ArLiveFeedEvent): void {
  try {
    arLiveFeedHub.publish(event);
  } catch {
    // Feed is best-effort and must never break product write paths.
  }
}
