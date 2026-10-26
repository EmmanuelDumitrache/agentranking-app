import { DASHBOARD_SOCIAL_LINK_DEFINITIONS, type OfficialLinkDefinition, type OfficialLinkType } from "@/lib/dashboard/official-links";
export async function putDashboardOfficialLinks(
  agentDbId: number,
  links: Record<OfficialLinkType, string>,
  definitions: OfficialLinkDefinition[],
  options?: { lockAll?: boolean },
): Promise<void> {
  const payload = definitions.map((def) => ({
    linkType: def.linkType,
    url: links[def.linkType],
  }));
  const res = await fetch(`/api/dashboard/agents/${agentDbId}/links`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lockAll: options?.lockAll ?? false, links: payload }),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to save links");
}
export const DASHBOARD_PROFILE_SOCIAL_DEFINITIONS = DASHBOARD_SOCIAL_LINK_DEFINITIONS;
