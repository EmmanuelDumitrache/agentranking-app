import { notFound } from "next/navigation";
import { TrendingUp } from "lucide-react";
import Link from "next/link";
import { requireDashboardAgentPage, requireDeveloperPreviewSection } from "@/lib/dashboard/page-auth";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ agentDbId: string }> };

export default async function DashboardAgentTradePerpsPage({ params }: Props) {
  const { agentDbId } = await params;
  const id = /^\d+$/.test(agentDbId) ? Number(agentDbId) : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const { agent } = await requireDashboardAgentPage(id);
  await requireDeveloperPreviewSection("trade-perps");
  const copyTradeHref = `/dashboard/agents/${agent.id}/trade/copy`;

  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <section className="ui-overview-summary overflow-hidden rounded-xl">
      <header className="ui-overview-identity flex items-start gap-3 px-4 py-3.5 sm:px-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
          <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Leverage</h1>
            <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              In development
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Perpetuals and leveraged trading for {agent.name} are in development.
          </p>
        </div>
      </header>
      </section>
      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-semibold">Perpetuals</h2>
        </div>
        <div className="px-5 py-4">
        <div className="ui-empty-state">
          <div className="ui-empty-state-icon" aria-hidden>
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="ui-empty-state-copy">
            <p className="ui-empty-state-title">Leverage trading coming soon</p>
            <p className="ui-empty-state-description">
              We&apos;re building a safer operator workflow for perps and leverage.
              In the meantime, you can mirror strategies with copy trade.
            </p>
          </div>
          <div className="ui-empty-state-action">
            <Button asChild variant="secondary">
              <Link href={copyTradeHref}>Open copy trade</Link>
            </Button>
          </div>
        </div>
        </div>
      </section>
    </div>
  );
}
