import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertDashboardMcpAccountAccess } from "@/features/agent-chat/server/mcp/dashboard-access";
import { getDashboardMcpProviderCatalog } from "@/features/agent-chat/server/mcp/dashboard-provider-catalog";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await assertDashboardMcpAccountAccess(session);
  if (!access.ok) return NextResponse.json({ error: "Forbidden" }, { status: access.status });
  const admission = request.nextUrl.searchParams.get("admission")?.toUpperCase();
  const category = request.nextUrl.searchParams.get("category")?.toLowerCase();
  const chain = request.nextUrl.searchParams.get("chainFamily")?.toLowerCase();
  const capability = request.nextUrl.searchParams.get("capability")?.toUpperCase();
  const riskLevel = request.nextUrl.searchParams.get("riskLevel")?.toUpperCase();
  const releaseStage = request.nextUrl.searchParams.get("releaseStage")?.toUpperCase();
  const priority = request.nextUrl.searchParams.get("priority")?.toUpperCase();
  const rawConnectable = request.nextUrl.searchParams.get("connectable")?.toLowerCase();
  const connectable = rawConnectable === "true" || rawConnectable === "false"
    ? rawConnectable
    : undefined;
  const search = request.nextUrl.searchParams.get("search")?.trim().toLowerCase();
  const catalog = await getDashboardMcpProviderCatalog(access.appAccountId);
  const providers = catalog.providers
    .filter((provider) => !admission || provider.admission === admission)
    .filter((provider) => !category || provider.categories.includes(category as never))
    .filter((provider) => !chain || provider.chainFamilies.some((item) => item.toLowerCase() === chain))
    .filter((provider) => !capability || provider.capabilityClasses.includes(capability as never))
    .filter((provider) => !riskLevel || provider.riskLevel === riskLevel)
    .filter((provider) => !releaseStage || provider.releaseStage === releaseStage)
    .filter((provider) => !priority || provider.priority === priority)
    .filter((provider) => connectable === undefined
      || (connectable === "true" && provider.connectable)
      || (connectable === "false" && !provider.connectable))
    .filter((provider) => !search || [
      provider.displayName,
      provider.publisherName,
      provider.summary,
      ...provider.categories,
      ...provider.chainFamilies,
      ...provider.capabilityClasses,
      provider.releaseStage,
      provider.riskLevel,
    ].join(" ").toLowerCase().includes(search));
  return NextResponse.json({ providers, customAllowed: catalog.customAllowed }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
