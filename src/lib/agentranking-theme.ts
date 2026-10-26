export const AGENTRANKING_THEME_STORAGE_KEY = "agentranking-theme";
export type AgentRankingThemePreference = "system" | "light" | "dark";
export type AgentRankingResolvedTheme = "light" | "dark";
export const DEFAULT_AGENTRANKING_THEME: AgentRankingThemePreference = "dark";
export function resolveAgentRankingTheme(
  preference: AgentRankingThemePreference,
  prefersDark: boolean,
): AgentRankingResolvedTheme {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }
  return preference;
}
export function readStoredThemePreference(): AgentRankingThemePreference {
  if (typeof window === "undefined") return DEFAULT_AGENTRANKING_THEME;
  try {
    const stored = localStorage.getItem(AGENTRANKING_THEME_STORAGE_KEY);
    if (stored === "system" || stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_AGENTRANKING_THEME;
}
export function applyAgentRankingTheme(resolved: AgentRankingResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}
export function persistThemePreference(preference: AgentRankingThemePreference): void {
  try {
    localStorage.setItem(AGENTRANKING_THEME_STORAGE_KEY, preference);
  } catch {
    /* ignore */
  }
}
/** Inline script — runs before paint to avoid theme flash. */
export const AGENTRANKING_THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(AGENTRANKING_THEME_STORAGE_KEY)};var s=localStorage.getItem(k)||${JSON.stringify(DEFAULT_AGENTRANKING_THEME)};var d=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;var r=s==="system"?(d?"dark":"light"):s;var el=document.documentElement;el.classList.remove("light","dark");el.classList.add(r==="light"?"light":"dark");el.style.colorScheme=r;}catch(e){document.documentElement.classList.add("dark");}})();`;