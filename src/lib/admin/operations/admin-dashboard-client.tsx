"use client";
import { useQuery } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import Link from "next/link";
import {
  BadgeCheck,
  Bot,
  ClipboardList,
  Coins,
  Flag,
  Image,
  MessageCircle,
  ShoppingCart,
  UserCircle2,
  Users,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AdminAlertBanner,
  AdminQuickAction,
  AdminSectionHeader,
  AdminStatCard,
} from "@/app/admin/(portal)/admin-dashboard-ui";
import { adminGreetingTitle, adminGreetingToken } from "@/app/admin/(portal)/admin-greeting";
interface FunnelStats {
  last7d: { page_view_advertise: number; page_view_boost: number; page_view_verify: number; order_created: number };
  last30d: { page_view_advertise: number; page_view_boost: number; page_view_verify: number; order_created: number };
  loading?: boolean;
}
interface DashboardNotification {
  id: string;
  title: string;
  count: number;
  href: string;
}
export interface AdminDashboardSummary {
  generatedAtMs: number;
  session: {
    username: string;
    createdAt: number;
    expiresAt: number;
    lastAccessIp: string | null;
    lastAccessAt: number | null;
  };
  security: {
    nodeEnv: string;
    adminCookieInsecureOptIn: boolean;
    secureCookieWhenProduction: boolean;
  };
  notifications: DashboardNotification[];
  counts: {
    pendingOrders: number;
    paidOrders: number;
    activeAds: number;
    totalUsers: number;
  };
  creators: {
    totalAppAccounts: number;
    newAppAccounts7d: number;
    nativeAgents: number;
    tokenizedLaunches: number;
    googleSignIns: number;
  };
  funnel: FunnelStats;
}
function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}d left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}
export function AdminDashboardClient({ initialData }: { readonly initialData: AdminDashboardSummary }) {
  const summaryQuery = useQuery({
    queryKey: adminKeys.dashboard(),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/admin/dashboard-summary", {
        credentials: "include",
        signal,
      });
      if (!response.ok) throw new Error("Could not load the admin dashboard");
      return (await response.json()) as AdminDashboardSummary;
    },
    initialData,
    refetchOnMount: false,
  });
  const summary = summaryQuery.data;
  const loading = summaryQuery.isPending;
  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="h-20 rounded-xl bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-muted" />
          ))}
        </div>
        <div className="h-12 w-full max-w-xl rounded-lg bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-6 text-sm">
        Could not load the dashboard. Try refreshing or signing in again.
      </div>
    );
  }
  const { session, security, notifications, counts, creators, funnel } = summary;
  const token = adminGreetingToken();
  const greet = adminGreetingTitle();
  const remainingMs = session.expiresAt - summary.generatedAtMs;
  return (
    <div className="space-y-8">
      <header className="rounded-xl border border-border bg-card/50 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-3xl font-black tracking-tight text-primary" aria-hidden>
              {token}
            </p>
            <h1 className="text-2xl font-bold tracking-tight">
              {greet}
              {session.username ? (
                <span className="font-normal text-muted-foreground"> — {session.username}</span>
              ) : null}
            </h1>
            <p className="text-sm text-muted-foreground">
              Creator accounts, agents, and launches from the live app database.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm lg:max-w-xs">
            <p className="font-medium">Session</p>
            <p className="mt-1 text-muted-foreground">
              Expires {formatTimeLeft(remainingMs)} · {security.nodeEnv}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {session.lastAccessIp ?? "IP unknown"}
            </p>
          </div>
        </div>
      </header>
      <AdminAlertBanner items={notifications} />
      <section className="space-y-4">
        <AdminSectionHeader
          title="Platform creators"
          description="Signed-in app accounts, native agents, and token launches."
          href="/admin/creators"
          linkLabel="Open creators →"
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <AdminStatCard
            href="/admin/creators"
            label="App accounts"
            value={creators?.totalAppAccounts ?? 0}
            icon={UserCircle2}
            iconClassName="text-primary"
            featured
          />
          <AdminStatCard
            href="/admin/creators"
            label="New this week"
            value={creators?.newAppAccounts7d ?? 0}
            sublabel="Last 7 days"
            icon={UserCircle2}
            iconClassName="text-sky-500"
          />
          <AdminStatCard
            href="/admin/creators"
            label="Native agents"
            value={creators?.nativeAgents ?? 0}
            icon={Bot}
            iconClassName="text-violet-500"
          />
          <AdminStatCard
            href="/admin/creators"
            label="Token launches"
            value={creators?.tokenizedLaunches ?? 0}
            icon={Coins}
            iconClassName="text-amber-500"
          />
          <AdminStatCard
            href="/admin/creators?provider=google"
            label="Google sign-ins"
            value={creators?.googleSignIns ?? 0}
            icon={Users}
            iconClassName="text-green-500"
          />
        </div>
      </section>
      <section className="space-y-3">
        <AdminSectionHeader title="Quick actions" description="Common admin workflows." />
        <div className="flex flex-wrap gap-2">
          <AdminQuickAction href="/admin/creators" label="Browse creators" icon={UserCircle2} />
          <AdminQuickAction href="/admin/verification-requests" label="Verification queue" icon={ClipboardList} />
          <AdminQuickAction href="/admin/verified-agents" label="Verified agents" icon={BadgeCheck} />
          <AdminQuickAction href="/admin/agent-reports" label="Reports" icon={Flag} />
          <AdminQuickAction href="/admin/orders" label="Orders" icon={ShoppingCart} />
          <AdminQuickAction href="/admin/contact" label="Support inbox" icon={MessageCircle} />
        </div>
      </section>
      <section className="space-y-4">
        <AdminSectionHeader
          title="Operations"
          description="Commerce, ads, and tooling."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AdminStatCard
            href="/admin/orders?status=pending"
            label="Pending orders"
            value={counts.pendingOrders}
            icon={ShoppingCart}
            iconClassName="text-yellow-500"
          />
          <AdminStatCard
            href="/admin/ads"
            label="Active ads"
            value={counts.activeAds}
            icon={Image}
            iconClassName="text-primary"
          />
          <AdminStatCard
            href="/admin/ar-token"
            label="Paid orders"
            value={counts.paidOrders}
            icon={Coins}
            iconClassName="text-green-500"
          />
        </div>
      </section>
      <Card className="border-border/80">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Account analytics</CardTitle>
          <CardDescription>
            Commerce funnel and user-profile counts alongside creator account data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/admin/users" className="text-muted-foreground hover:text-foreground hover:underline">
              User profiles: <span className="font-mono font-medium text-foreground">{counts.totalUsers}</span>
            </Link>
            <Link href="/admin/accounts" className="text-muted-foreground hover:text-foreground hover:underline">
              Dashboard accounts →
            </Link>
            <Link href="/admin/insights" className="text-muted-foreground hover:text-foreground hover:underline">
              Full insights →
            </Link>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Conversion event</th>
                  <th className="px-3 py-2 text-right font-medium">7d</th>
                  <th className="px-3 py-2 text-right font-medium">30d</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/50">
                  <td className="px-3 py-2">Advertise views</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {funnel.loading ? "…" : funnel.last7d.page_view_advertise}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {funnel.loading ? "…" : funnel.last30d.page_view_advertise}
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-3 py-2">Boost views</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {funnel.loading ? "…" : funnel.last7d.page_view_boost}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {funnel.loading ? "…" : funnel.last30d.page_view_boost}
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-3 py-2">Verify views</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {funnel.loading ? "…" : funnel.last7d.page_view_verify}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {funnel.loading ? "…" : funnel.last30d.page_view_verify}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">Orders created</td>
                  <td className="px-3 py-2 text-right font-mono font-medium">
                    {funnel.loading ? "…" : funnel.last7d.order_created}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-medium">
                    {funnel.loading ? "…" : funnel.last30d.order_created}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
