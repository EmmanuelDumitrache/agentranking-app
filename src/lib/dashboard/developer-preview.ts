import "server-only";

import { isDeveloperDevToolsActive } from "@/lib/dashboard/developer-access";
export type { DeveloperPreviewSection } from "@/lib/dashboard/developer-preview-sections";
export {
  DEVELOPER_PREVIEW_NAV_SECTIONS,
  isDeveloperPreviewNavSection,
} from "@/lib/dashboard/developer-preview-sections";

export function canAccessDeveloperPreviewSection(accountEmail?: string | null): boolean {
  return isDeveloperDevToolsActive(accountEmail);
}
