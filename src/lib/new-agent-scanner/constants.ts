
export const NEW_SCANNER_PER_PAGE = 20;
export const NEW_SCANNER_POLL_VISIBLE_MS = 15_000;
export const NEW_SCANNER_POLL_HIDDEN_MS = 10 * 60_000;
export const NEW_SCANNER_LIVE_POLL_SECONDS = Math.round(NEW_SCANNER_POLL_VISIBLE_MS / 1000);
/** How long fresh / missed highlights stay visible. */
export const NEW_SCANNER_CATCHUP_HIGHLIGHT_MS = 4_500;