import Link from "next/link";
import { BarChart3, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readAdminConversionStats } from "@/lib/admin/operations/insights.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";
export const dynamic = "force-dynamic";

export default async function AdminInsightsPage() {
  const funnel = await loadAdminOperationsPage(readAdminConversionStats);
  return (
    <div>
      <div className="flex items-center gap-4 mb-8">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/admin">
            <ArrowLeft className="size-4" />
            Dashboard
          </Link>
        </Button>
      </div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <BarChart3 className="size-6" />
        Conversion Insights
      </h1>
      {funnel ? (
        <div className="rounded-lg border border-border bg-card p-6 max-w-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 font-medium">Event</th>
                <th className="text-right py-3 font-medium">Last 7 days</th>
                <th className="text-right py-3 font-medium">Last 30 days</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/50">
                <td className="py-3">Advertise page views</td>
                <td className="text-right py-3 font-mono">{funnel.last7d.page_view_advertise}</td>
                <td className="text-right py-3 font-mono">{funnel.last30d.page_view_advertise}</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-3">Boost page views</td>
                <td className="text-right py-3 font-mono">{funnel.last7d.page_view_boost}</td>
                <td className="text-right py-3 font-mono">{funnel.last30d.page_view_boost}</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-3">Verify page views</td>
                <td className="text-right py-3 font-mono">{funnel.last7d.page_view_verify}</td>
                <td className="text-right py-3 font-mono">{funnel.last30d.page_view_verify}</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-3 font-medium">Orders created</td>
                <td className="text-right py-3 font-mono font-medium">{funnel.last7d.order_created}</td>
                <td className="text-right py-3 font-mono font-medium">{funnel.last30d.order_created}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground">No funnel data available.</p>
      )}
    </div>
  );
}
