"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import Link from "next/link";
import {
  Coins,
  Loader2,
  Save,
  ShieldCheck,
  Users,
  Link2,
  Send,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  emptyArTokenMetrics,
  type ArTokenMetricsView,
  type ArTokenPerkConfigView,
  type ArTokenSettingsView,
} from "@/lib/ar-token-metrics";
import { Field, AdminTable } from "./admin-ui";
import { useSourceDraft } from "@/hooks/use-source-draft";
type Settings = ArTokenSettingsView;
type Metrics = ArTokenMetricsView;
const EVENT_TYPES = [
  { value: "burn", label: "Burn" },
  { value: "buyback", label: "Buyback" },
  { value: "treasury_in", label: "Treasury in" },
  { value: "treasury_out", label: "Treasury out" },
  { value: "bounty_reward", label: "Bounty reward" },
  { value: "staking_reward", label: "Staking reward" },
  { value: "staking_deposit", label: "Staking deposit" },
  { value: "staking_withdrawal", label: "Staking withdrawal" },
  { value: "liquidity_add", label: "Liquidity add" },
  { value: "liquidity_remove", label: "Liquidity remove" },
  { value: "revenue_fee", label: "Revenue fee" },
] as const;
const EMPTY_SETTINGS: Settings = {
  ...emptyArTokenMetrics().settings,
};
const EMPTY_EVENT = {
  eventType: "burn",
  amountToken: "",
  amountUsd: "",
  wallet: "",
  txHash: "",
  note: "",
  occurredAt: "",
};
function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function formatRaw(raw: string): string {
  if (!/^\d+$/.test(raw)) return "0";
  const whole = BigInt(raw) / BigInt(10) ** BigInt(18);
  return Number(whole).toLocaleString();
}
export function AdminArTokenClient({ initialMetrics }: { readonly initialMetrics: ArTokenMetricsView }) {
  const metricsQuery = useQuery({
    queryKey: adminKeys.arToken(),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/admin/ar-token", { credentials: "include", signal });
      const payload = (await response.json()) as Metrics & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to fetch token metrics");
      return payload;
    },
    initialData: initialMetrics,
    refetchOnMount: false,
  });
  const { data: loadedMetrics, isLoading: loading, error: loadError } = metricsQuery;
  const metricsSource = loadedMetrics ?? emptyArTokenMetrics();
  const [metrics, setMetrics] = useSourceDraft(JSON.stringify(metricsSource), metricsSource);
  const [settings, setSettings] = useSourceDraft(
    JSON.stringify(metricsSource.settings),
    metricsSource.settings ?? EMPTY_SETTINGS,
  );
  const [perks, setPerks] = useSourceDraft(
    JSON.stringify(metricsSource.perks),
    metricsSource.perks ?? [],
  );
  const [eventForm, setEventForm] = useState(EMPTY_EVENT);
  const [holderForm, setHolderForm] = useState({
    wallet: "",
    tokenBalanceRaw: "0",
    tokenBalanceUi: "0",
    achievedTier: "",
    eligiblePerks: "",
    referralCount: "0",
    manualReferralAdjust: "0",
    paidVerifiedAgentCount: "0",
    claimedAgentCount: "0",
    profilePath: "",
    note: "",
  });
  const [activeTab, setActiveTab] = useState("setup");
  const [saving, setSaving] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const visibleFeedback = feedback ?? loadError?.message ?? null;
  async function saveSettings() {
    setSaving("settings");
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ar-token", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...settings, tokenLedger: "solana" }),
      });
      const data = (await res.json()) as Metrics & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save settings");
      setMetrics(data);
      setSettings(data.settings);
      setPerks(data.perks);
      setFeedback("Launch & links saved.");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving("");
    }
  }
  async function postAction(action: string, body: Record<string, unknown>, okMessage: string) {
    setSaving(action);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ar-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, ...body }),
      });
      const data = (await res.json()) as Metrics & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      setMetrics(data);
      setSettings(data.settings);
      setPerks(data.perks);
      setFeedback(okMessage);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSaving("");
    }
  }
  async function recordEvent() {
    await postAction("record_metric_event", eventForm, "Token event recorded and reflected on the public page.");
    setEventForm(EMPTY_EVENT);
  }
  const summary = useMemo(
    () => ({
      holders: metrics.holders.total,
      referrals: metrics.referrals.totalQualified,
      payoutDrafts: metrics.payout.batches.filter((batch) => batch.status === "draft").length,
      perks: perks.filter((perk) => perk.status !== "hidden").length,
    }),
    [metrics, perks],
  );
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading $AR admin...
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Coins className="size-6 text-primary" />
            $AR Token Admin
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Holder perks, launch links, and events for $AR on Solana (Pump.fun). Referrals, payouts, and staking each have
            their own admin pages from the sidebar.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/locked-supply" target="_blank">
            View lock registry
          </Link>
        </Button>
      </div>
      {visibleFeedback && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
          {visibleFeedback}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard icon={ShieldCheck} label="Perks" value={String(summary.perks)} />
        <SummaryCard icon={Users} label="Holder snapshots" value={formatNumber(summary.holders)} />
        <SummaryCard icon={Link2} label="Qualified referrals" value={formatNumber(summary.referrals)} />
        <SummaryCard icon={Send} label="Payout drafts" value={formatNumber(summary.payoutDrafts)} />
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Focused screens:</span> staking rules, referrals, and payout batches
          each have their own admin page — fewer tabs here.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/ar-token/staking">Staking</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/ar-token/referrals">Referrals</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/ar-token/payouts">Payouts</Link>
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-2">
        {[
          ["setup", "Launch & links"],
          ["perks", "Perks"],
          ["holders", "Holders"],
          ["events", "Events"],
        ].map(([id, label]) => (
          <Button key={id} size="sm" variant={activeTab === id ? "default" : "ghost"} onClick={() => setActiveTab(id)}>
            {label}
          </Button>
        ))}
      </div>
      {activeTab === "setup" && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div>
            <h2 className="text-lg font-semibold">Pump.fun launch &amp; public links</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              $AR is treated as a Solana token (Pump.fun). Configure the SPL mint and cluster so holder perks and metrics can
              read wallet balances. Optional RPC override:{" "}
              <code className="rounded bg-muted px-0.5 text-[10px]">NEXT_PUBLIC_AR_SOLANA_RPC_URL</code>.
            </p>
          </div>
          {settings.tokenLedger === "solana" ? null : (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <p className="font-medium text-foreground">Ledger is not set to Solana</p>
              <p className="mt-1 text-muted-foreground">
                For Pump.fun, switch to Solana and fill in the mint below. Saving this tab will store settings as Solana.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setSettings((s) => ({ ...s, tokenLedger: "solana", tokenChainId: 0 }))}
              >
                Use Solana (Pump.fun)
              </Button>
            </div>
          )}
          <div className="rounded-lg border border-border bg-background/50 px-4 py-3 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Env alignment:</span> set{" "}
              <code className="rounded bg-muted px-0.5 text-[10px]">NEXT_PUBLIC_AR_TOKEN_LEDGER=solana</code> and match{" "}
              <code className="rounded bg-muted px-0.5 text-[10px]">NEXT_PUBLIC_AR_SOLANA_CLUSTER</code> to the cluster
              below so the public site matches admin.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Launch status"
              value={settings.launchStatus}
              onChange={(v) => setSettings((s) => ({ ...s, launchStatus: v }))}
              placeholder="prelaunch | launched"
            />
            <Field
              label="SPL mint address (Pump.fun token mint)"
              value={settings.tokenAddress}
              onChange={(v) => setSettings((s) => ({ ...s, tokenAddress: v }))}
              placeholder="Paste mint pubkey after Pump.fun graduation / migration"
            />
            <div className="space-y-1.5">
              <Label>Solana cluster</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={settings.solanaCluster}
                onChange={(e) => setSettings((s) => ({ ...s, solanaCluster: e.target.value }))}
              >
                <option value="mainnet-beta">mainnet-beta</option>
                <option value="devnet">devnet</option>
                <option value="testnet">testnet</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>SPL decimals</Label>
              <Input
                inputMode="numeric"
                value={String(settings.tokenDecimals)}
                onChange={(e) => {
                  const t = e.target.value.trim();
                  const n = t === "" ? 18 : Number.parseInt(t, 10);
                  setSettings((s) => ({
                    ...s,
                    tokenDecimals: Number.isFinite(n) ? Math.min(36, Math.max(0, n)) : 18,
                  }));
                }}
                placeholder="6 or 9 typical for SPL"
              />
              <p className="text-[11px] text-muted-foreground">Usually 6 or 9 on Pump.fun / SPL (not 18).</p>
            </div>
            <Field
              label="Pump.fun URL"
              value={settings.pumpFunUrl}
              onChange={(v) => setSettings((s) => ({ ...s, pumpFunUrl: v }))}
              placeholder="https://pump.fun/coin/..."
            />
            <Field
              label="Buy URL"
              value={settings.buyUrl}
              onChange={(v) => setSettings((s) => ({ ...s, buyUrl: v }))}
              placeholder="Pump.fun buy link or Jupiter deep link"
            />
            <Field
              label="DEXScreener pair / token address"
              value={settings.pairAddress}
              onChange={(v) => setSettings((s) => ({ ...s, pairAddress: v }))}
            />
            <Field
              label="DEXScreener URL"
              value={settings.dexScreenerUrl}
              onChange={(v) => setSettings((s) => ({ ...s, dexScreenerUrl: v }))}
              placeholder="https://dexscreener.com/solana/..."
            />
            <Field
              label="Holder access threshold (display)"
              value={settings.holderAccessThreshold}
              onChange={(v) => setSettings((s) => ({ ...s, holderAccessThreshold: v }))}
              placeholder="e.g. 100,000 $AR"
            />
            <label className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={settings.stakingEnabled}
                onChange={(e) => setSettings((s) => ({ ...s, stakingEnabled: e.target.checked }))}
              />
              <span>Staking enabled (show staking UX when you turn this on)</span>
            </label>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Optional treasury labels</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              For display and exports — not required for Pump.fun launch.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Treasury wallet" value={settings.treasuryWallet} onChange={(v) => setSettings((s) => ({ ...s, treasuryWallet: v }))} />
              <Field label="Rewards wallet" value={settings.rewardsWallet} onChange={(v) => setSettings((s) => ({ ...s, rewardsWallet: v }))} />
              <Field label="Buyback wallet" value={settings.buybackWallet} onChange={(v) => setSettings((s) => ({ ...s, buybackWallet: v }))} />
              <Field label="Burn wallet" value={settings.burnWallet} onChange={(v) => setSettings((s) => ({ ...s, burnWallet: v }))} />
              <Field label="Liquidity wallet" value={settings.liquidityWallet} onChange={(v) => setSettings((s) => ({ ...s, liquidityWallet: v }))} />
            </div>
          </div>
          <Button onClick={saveSettings} disabled={saving === "settings"} className="gap-2">
            {saving === "settings" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save launch &amp; links
          </Button>
        </section>
      )}
      {activeTab === "perks" && <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><SlidersHorizontal className="size-5 text-primary" /> Dynamic perks</h2>
          <p className="text-sm text-muted-foreground">Adjust copy, thresholds, and coming-soon states as token price and launch strategy evolve.</p>
        </div>
        <div className="space-y-4">
          {perks.map((perk, index) => (
            <div key={perk.id} className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Title" value={perk.title} onChange={(v) => setPerks((rows) => rows.map((row) => row.id === perk.id ? { ...row, title: v } : row))} />
                <Field label="Short title" value={perk.shortTitle} onChange={(v) => setPerks((rows) => rows.map((row) => row.id === perk.id ? { ...row, shortTitle: v } : row))} />
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={perk.status} onChange={(e) => setPerks((rows) => rows.map((row) => row.id === perk.id ? { ...row, status: e.target.value as ArTokenPerkConfigView["status"] } : row))}>
                    <option value="active">active</option>
                    <option value="coming_soon">coming soon</option>
                    <option value="hidden">hidden</option>
                  </select>
                </div>
                <Field label="Min hold raw (18 decimals)" value={perk.minBalanceRaw} onChange={(v) => setPerks((rows) => rows.map((row) => row.id === perk.id ? { ...row, minBalanceRaw: v } : row))} />
                <Field label="Max/full access raw" value={perk.maxBalanceRaw} onChange={(v) => setPerks((rows) => rows.map((row) => row.id === perk.id ? { ...row, maxBalanceRaw: v } : row))} />
                <Field label="Display order" value={String(perk.displayOrder)} onChange={(v) => setPerks((rows) => rows.map((row) => row.id === perk.id ? { ...row, displayOrder: Number.parseInt(v, 10) || index * 10 } : row))} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Textarea value={perk.description} onChange={(e) => setPerks((rows) => rows.map((row) => row.id === perk.id ? { ...row, description: e.target.value } : row))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Reward summary</Label>
                  <Textarea value={perk.rewardSummary} onChange={(e) => setPerks((rows) => rows.map((row) => row.id === perk.id ? { ...row, rewardSummary: e.target.value } : row))} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Public display threshold: {formatRaw(perk.minBalanceRaw)} $AR</p>
            </div>
          ))}
        </div>
        <Button onClick={() => postAction("save_perks", { perks }, "Perks saved.")} disabled={saving === "save_perks"} className="gap-2">
          {saving === "save_perks" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save perks
        </Button>
      </section>}
      {activeTab === "holders" && <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Holder snapshots</h2>
          <p className="text-sm text-muted-foreground">Manual MVP snapshots for holders, balances, perks, profile links, and referral counts.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Wallet" value={holderForm.wallet} onChange={(v) => setHolderForm((f) => ({ ...f, wallet: v }))} />
          <Field label="Balance raw" value={holderForm.tokenBalanceRaw} onChange={(v) => setHolderForm((f) => ({ ...f, tokenBalanceRaw: v }))} />
          <Field label="Balance UI" value={holderForm.tokenBalanceUi} onChange={(v) => setHolderForm((f) => ({ ...f, tokenBalanceUi: v }))} />
          <Field label="Achieved tier/perk" value={holderForm.achievedTier} onChange={(v) => setHolderForm((f) => ({ ...f, achievedTier: v }))} />
          <Field label="Eligible perks (comma separated)" value={holderForm.eligiblePerks} onChange={(v) => setHolderForm((f) => ({ ...f, eligiblePerks: v }))} />
          <Field label="Profile path" value={holderForm.profilePath} onChange={(v) => setHolderForm((f) => ({ ...f, profilePath: v }))} />
          <Field label="Referral count" value={holderForm.referralCount} onChange={(v) => setHolderForm((f) => ({ ...f, referralCount: v }))} />
          <Field label="Paid verified agents" value={holderForm.paidVerifiedAgentCount} onChange={(v) => setHolderForm((f) => ({ ...f, paidVerifiedAgentCount: v }))} />
          <Field label="Claimed agents" value={holderForm.claimedAgentCount} onChange={(v) => setHolderForm((f) => ({ ...f, claimedAgentCount: v }))} />
        </div>
        <Button onClick={() => postAction("upsert_holder", { ...holderForm, eligiblePerks: holderForm.eligiblePerks.split(",").map((v) => v.trim()).filter(Boolean), source: "manual" }, "Holder snapshot saved.")} disabled={saving === "upsert_holder"}>
          Save holder snapshot
        </Button>
        <AdminTable headers={["Wallet", "Balance", "Tier", "Referrals", "Profile"]}>
          {metrics.holders.top.map((holder) => (
            <tr key={holder.id} className="border-b border-border/50">
              <td className="py-2 font-mono text-xs">{holder.wallet}</td>
              <td className="py-2">{holder.tokenBalanceUi || formatRaw(holder.tokenBalanceRaw)}</td>
              <td className="py-2">{holder.achievedTier || holder.eligiblePerks.join(", ") || "—"}</td>
              <td className="py-2">{holder.referralCount + holder.manualReferralAdjust}</td>
              <td className="py-2">{holder.profilePath ? <Link className="text-primary hover:underline" href={holder.profilePath}>Open</Link> : "—"}</td>
            </tr>
          ))}
        </AdminTable>
      </section>}
      {activeTab === "events" && <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Record manual event</h2>
          <p className="text-sm text-muted-foreground">
            Record off-chain/admin-confirmed moves now; later these can be replaced or reconciled with on-chain indexers.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Event type</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={eventForm.eventType}
              onChange={(e) => setEventForm((f) => ({ ...f, eventType: e.target.value }))}
            >
              {EVENT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
          <Field label="Amount token" value={eventForm.amountToken} onChange={(v) => setEventForm((f) => ({ ...f, amountToken: v }))} placeholder="e.g. 1000000" />
          <Field label="Amount USD" value={eventForm.amountUsd} onChange={(v) => setEventForm((f) => ({ ...f, amountUsd: v }))} placeholder="Optional" />
          <Field label="Wallet" value={eventForm.wallet} onChange={(v) => setEventForm((f) => ({ ...f, wallet: v }))} placeholder="Source or destination wallet" />
          <Field label="Transaction hash" value={eventForm.txHash} onChange={(v) => setEventForm((f) => ({ ...f, txHash: v }))} placeholder="Optional until on-chain" />
          <Field label="Occurred at" value={eventForm.occurredAt} onChange={(v) => setEventForm((f) => ({ ...f, occurredAt: v }))} placeholder="YYYY-MM-DD or ISO date" />
          <div className="space-y-1.5 md:col-span-2">
            <Label>Note</Label>
            <Textarea
              value={eventForm.note}
              onChange={(e) => setEventForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="Example: manual burn from verified-agent fee allocation"
            />
          </div>
        </div>
        <Button onClick={recordEvent} disabled={Boolean(saving)} className="gap-2">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Record event
        </Button>
      </section>}
      {activeTab === "events" && <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold mb-3">Recent public events</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 text-left font-medium">Type</th>
                <th className="py-2 text-right font-medium">Token</th>
                <th className="py-2 text-right font-medium">USD</th>
                <th className="py-2 text-left font-medium">Note</th>
                <th className="py-2 text-right font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {(metrics?.history.recentEvents ?? []).map((event) => (
                <tr key={event.id} className="border-b border-border/50">
                  <td className="py-2 font-mono text-xs">{event.eventType}</td>
                  <td className="py-2 text-right font-mono">{event.amountToken || "—"}</td>
                  <td className="py-2 text-right font-mono">{event.amountUsd || "—"}</td>
                  <td className="py-2 text-muted-foreground">{event.note || "—"}</td>
                  <td className="py-2 text-right text-muted-foreground">{new Date(event.occurredAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {(metrics?.history.recentEvents ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    No events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>}
    </div>
  );
}
function SummaryCard({
  icon: Icon,
  label,
  value,
}: Readonly<{ icon: LucideIcon; label: string; value: string }>) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Icon className="size-5 text-primary" />
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-bold">{value}</p>
        </div>
      </div>
    </div>
  );
}
