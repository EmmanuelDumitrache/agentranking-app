import type { DashboardWorkspaceSection } from "@/lib/dashboard/navigation";

/** Sidebar routes visible to everyone but only accessible on developer allowlist. */
export const DEVELOPER_PREVIEW_NAV_SECTIONS = [
  "card",
  "trade-swap",
  "trade-perps",
  "trade-copy",
] as const satisfies readonly DashboardWorkspaceSection[];

export type DeveloperPreviewSection = (typeof DEVELOPER_PREVIEW_NAV_SECTIONS)[number];

const DEVELOPER_PREVIEW_SECTION_SET = new Set<string>(DEVELOPER_PREVIEW_NAV_SECTIONS);

export function isDeveloperPreviewNavSection(
  section: DashboardWorkspaceSection,
): section is DeveloperPreviewSection {
  return DEVELOPER_PREVIEW_SECTION_SET.has(section);
}
