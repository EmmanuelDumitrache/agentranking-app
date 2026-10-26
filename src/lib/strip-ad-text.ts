/** Strip marquee + checkout POST cap: aligns display with paid checkout slice. */
export const STRIP_AD_DISPLAY_MAX_CHARS = 80;
export function normalizeStripAdDisplayText(raw: string): string {
  const t = raw.trim();
  if (t.length <= STRIP_AD_DISPLAY_MAX_CHARS) return t;
  return t.slice(0, STRIP_AD_DISPLAY_MAX_CHARS);
}