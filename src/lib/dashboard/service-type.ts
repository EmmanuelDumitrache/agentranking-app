export type DashboardServiceType =
  | "website"
  | "api"
  | "mcp"
  | "a2a"
  | "x402"
  | "docs"
  | "custom";
const DOCS_HINTS = ["/docs", "/doc", "readme", "gitbook", "documentation", "swagger", "openapi"];
export function classifyDashboardServiceType(input: {
  name: string;
  endpoint: string;
  x402Detected?: boolean;
}): DashboardServiceType {
  const name = input.name.trim().toLowerCase();
  const endpoint = input.endpoint.trim().toLowerCase();
  if (input.x402Detected || name.includes("x402") || endpoint.includes("x402")) {
    return "x402";
  }
  if (name.includes("mcp") || endpoint.includes("/mcp") || endpoint.includes("mcp.")) {
    return "mcp";
  }
  if (name.includes("a2a") || endpoint.includes("/a2a") || endpoint.includes("a2a.")) {
    return "a2a";
  }
  if (DOCS_HINTS.some((h) => name.includes(h) || endpoint.includes(h))) {
    return "docs";
  }
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    try {
      const url = new URL(endpoint);
      const path = url.pathname.toLowerCase();
      if (path === "/" || path === "") return "website";
      if (path.includes("/api") || path.includes("/v1") || path.includes("/v2")) return "api";
      return "api";
    } catch {
      return "custom";
    }
  }
  if (!endpoint) return "custom";
  return "custom";
}
export function dashboardServiceTypeLabel(type: DashboardServiceType): string {
  switch (type) {
    case "website":
      return "Website";
    case "api":
      return "API";
    case "mcp":
      return "MCP";
    case "a2a":
      return "A2A";
    case "x402":
      return "x402";
    case "docs":
      return "Docs";
    default:
      return "Custom";
  }
}
export type DashboardServiceTab = "all" | DashboardServiceType;
export const DASHBOARD_SERVICE_TABS: DashboardServiceTab[] = [
  "all",
  "mcp",
  "a2a",
  "x402",
  "api",
  "docs",
  "custom",
];
export function defaultServiceNameForType(type: DashboardServiceType): string {
  switch (type) {
    case "mcp":
      return "MCP";
    case "a2a":
      return "A2A";
    case "x402":
      return "X402";
    case "api":
      return "API";
    case "docs":
      return "DOCS";
    case "website":
      return "WEB";
    default:
      return "CUSTOM";
  }
}
export function endpointPlaceholderForType(type: DashboardServiceType): string {
  switch (type) {
    case "mcp":
      return "https://example.com/mcp";
    case "a2a":
      return "https://example.com/a2a";
    case "x402":
      return "https://example.com/api/paid";
    case "docs":
      return "https://docs.example.com";
    default:
      return "https://…";
  }
}
export function serviceMatchesTab(
  service: { name: string; endpoint: string },
  tab: DashboardServiceTab,
  x402Detected?: boolean,
): boolean {
  if (tab === "all") return true;
  return (
    classifyDashboardServiceType({ ...service, x402Detected }) === tab
  );
}
export function countServicesByTab(
  services: ReadonlyArray<{ name: string; endpoint: string }>,
  x402Detected?: boolean,
): Record<DashboardServiceTab, number> {
  const counts = Object.fromEntries(
    DASHBOARD_SERVICE_TABS.map((tab) => [tab, 0]),
  ) as Record<DashboardServiceTab, number>;
  counts.all = services.length;
  for (const service of services) {
    const type = classifyDashboardServiceType({ ...service, x402Detected });
    counts[type] += 1;
  }
  return counts;
}
