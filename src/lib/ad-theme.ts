export const ADVERTISER_NAME_MAX_CHARS = 32;
export const DEFAULT_AD_ICON_KEY = "shield";
export const DEFAULT_AD_ACCENT_COLOR = "#22c55e";
export const AD_ICON_OPTIONS = [
  { key: "shield", label: "Shield" },
  { key: "rocket", label: "Rocket" },
  { key: "bot", label: "Bot" },
  { key: "sparkles", label: "Sparkles" },
  { key: "trending", label: "Trending" },
  { key: "megaphone", label: "Megaphone" },
  { key: "zap", label: "Zap" },
  { key: "star", label: "Star" },
  { key: "target", label: "Target" },
  { key: "flame", label: "Flame" },
  { key: "gem", label: "Gem" },
  { key: "globe", label: "Globe" },
  { key: "code", label: "Code" },
  { key: "chart", label: "Chart" },
  { key: "coins", label: "Coins" },
] as const;
export type AdIconKey = (typeof AD_ICON_OPTIONS)[number]["key"];
export const AD_ACCENT_COLOR_OPTIONS = [
  "#22c55e",
  "#14b8a6",
  "#38bdf8",
  "#8b5cf6",
  "#f59e0b",
  "#f43f5e",
] as const;
const AD_ICON_KEYS = new Set<string>(AD_ICON_OPTIONS.map((option) => option.key));
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
export function normalizeAdIconKey(value: unknown): AdIconKey {
  const key = stringValue(value).trim().toLowerCase();
  return AD_ICON_KEYS.has(key) ? (key as AdIconKey) : DEFAULT_AD_ICON_KEY;
}
export function normalizeAdAccentColor(value: unknown): string {
  const color = stringValue(value).trim();
  return HEX_COLOR_RE.test(color) ? color.toLowerCase() : DEFAULT_AD_ACCENT_COLOR;
}
export function normalizeAdvertiserDisplayName(value: unknown): string {
  return stringValue(value).trim().slice(0, ADVERTISER_NAME_MAX_CHARS);
}