import { getOrInsertComputed } from "@/lib/map-upsert";
export type PortfolioActivityCategory =
  | "analytics"
  | "signal"
  | "github"
  | "verification";
export type PortfolioActivityItem = {
  id: string;
  agentId: number;
  agentName: string;
  label: string;
  category: PortfolioActivityCategory;
  at: Date;
};
export type PortfolioActivityItemDto = Omit<PortfolioActivityItem, "at"> & {
  at: string;
};
export function hydratePortfolioActivityItems(
  items: readonly PortfolioActivityItemDto[],
): PortfolioActivityItem[] {
  return items.map((item) => ({ ...item, at: new Date(item.at) }));
}
export type AgentActivityStats = {
  count: number;
  latestAt: Date | null;
  recent7d: boolean;
};
export function summarizeActivityByAgent(
  items: PortfolioActivityItem[],
): Map<number, AgentActivityStats> {
  const map = new Map<number, AgentActivityStats>();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const item of items) {
    const existing = getOrInsertComputed(map, item.agentId, () => ({
      count: 0,
      latestAt: null,
      recent7d: false,
    }));
    existing.count += 1;
    if (!existing.latestAt || item.at > existing.latestAt) {
      existing.latestAt = item.at;
    }
    if (item.at.getTime() >= sevenDaysAgo) {
      existing.recent7d = true;
    }
  }
  return map;
}
export function groupActivityByDay(items: PortfolioActivityItem[]): Array<{
  dayKey: string;
  dayLabel: string;
  items: PortfolioActivityItem[];
}> {
  const groups = new Map<string, PortfolioActivityItem[]>();
  for (const item of items) {
    const dayKey = item.at.toISOString().slice(0, 10);
    getOrInsertComputed(groups, dayKey, () => []).push(item);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dayKey, dayItems]) => ({
      dayKey,
      dayLabel: formatDayLabel(dayKey),
      items: dayItems,
    }));
}
function formatDayLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00.000Z`);
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);
  if (dayKey === todayKey) return "Today";
  if (dayKey === yesterdayKey) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}
