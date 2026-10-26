"use client";
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Save, Trash2, Search, Lock, Unlock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminKeys } from "@/lib/query-keys/admin";
import { AR_HOLDER_TIERS, formatHolderTokenAmount } from "@/lib/ar-holder-perk-config";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AdminStakePerkRuleDto {
  id: string;
  name: string;
  description: string;
  perkSlug: string;
  minStakeRaw: string;
  minLockDays: number;
  priority: number;
  isActive: boolean;
}
export interface AdminStakePositionDto {
  id: string;
  wallet: string;
  poolAddress: string;
  amountRaw: string;
  amountUi: string;
  nonce: number;
  durationSec: number;
  lockEndAt: string | null;
  txSignature: string;
  status: string;
  source: string;
  adminNote: string;
  lastSyncedAt?: string;
  createdAt: string;
}
export interface AdminStakePerkOverrideDto {
  id: string;
  wallet: string;
  perkSlug: string;
  overrideType: string;
  adminNote: string;
  expiresAt: string | null;
  createdAt: string;
}
interface PreviewResult {
  unlockedPerks: string[];
  activePositions: AdminStakePositionDto[];
  appliedRules: Array<{ ruleId: string; ruleName: string; perkSlug: string }>;
  appliedOverrides: Array<{ perkSlug: string; overrideType: string; adminNote: string }>;
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDays(sec: number): string {
  if (!sec) return "—";
  const d = Math.floor(sec / 86400);
  return d === 1 ? "1 day" : `${d} days`;
}
function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}
function formatRuleMinStakeRawUi(rawStr: string): string {
  const s = rawStr?.trim().replace(/,/g, "") ?? "";
  if (!/^\d+$/.test(s)) return "—";
  try {
    return `≈ ${formatHolderTokenAmount(BigInt(s))} $AR`;
  } catch {
    return "—";
  }
}
function StatusBadge({ status }: Readonly<{ status: string }>) {
  let color: string;
  if (status === "active") {
    color = "bg-green-500/15 text-green-400";
  } else if (status === "unstaked") {
    color = "bg-amber-500/15 text-amber-400";
  } else {
    color = "bg-muted text-muted-foreground";
  }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}
// ---------------------------------------------------------------------------
// Sub-section: Perk Rules
// ---------------------------------------------------------------------------
const EMPTY_RULE: Omit<AdminStakePerkRuleDto, "id"> = {
  name: "",
  description: "",
  perkSlug: "",
  minStakeRaw: "0",
  minLockDays: 0,
  priority: 0,
  isActive: true,
};
const HOLDER_TIER_RULE_OPTIONS = [
  { slug: "holder-tier-node", title: "Holder tier: 7 days" },
  { slug: "holder-tier-validator", title: "Holder tier: 14 days" },
  { slug: "holder-tier-core", title: "Holder tier: 30 days" },
];
function PerkRulesSection({ perks, initialRules }: Readonly<{ perks: Array<{ slug: string; title: string }>; initialRules: AdminStakePerkRuleDto[] }>) {
  const [saving, setSaving] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<AdminStakePerkRuleDto, "id"> & { id?: string }>(EMPTY_RULE);
  const loadRules = useCallback(async (signal: AbortSignal): Promise<AdminStakePerkRuleDto[]> => {
    const response = await fetch("/api/admin/ar-token/stake-rules", {
      credentials: "include",
      signal,
    });
    if (!response.ok) throw new Error("Could not load stake rules");
    const data = (await response.json()) as { rules?: AdminStakePerkRuleDto[] };
    return data.rules ?? [];
  }, []);
  const rulesQuery = useQuery({
    queryKey: adminKeys.arTokenStakeRules(),
    queryFn: ({ signal }) => loadRules(signal),
    initialData: initialRules,
    refetchOnMount: false,
  });
  const rules = rulesQuery.data ?? [];
  const loading = rulesQuery.isPending;
  const refreshRules = () => void rulesQuery.refetch();
  async function saveRule() {
    setSaving("rule");
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ar-token/stake-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Save failed");
      setFeedback("Rule saved.");
      setForm({ ...EMPTY_RULE });
      refreshRules();
    } catch {
      setFeedback("Failed to save rule.");
    } finally {
      setSaving("");
    }
  }
  async function deleteRule(id: string) {
    if (!confirm("Delete this rule?")) return;
    await fetch("/api/admin/ar-token/stake-rules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id }),
    });
    refreshRules();
  }
  function editRule(rule: AdminStakePerkRuleDto) {
    setForm({ ...rule });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function seedTierRules() {
    setSaving("seed");
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ar-token/stake-rules/seed", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as { created?: string[]; updated?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Seed failed");
      setFeedback(
        `Tier rules seeded (${(data.created ?? []).length} created, ${(data.updated ?? []).length} updated).`,
      );
      refreshRules();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Failed to seed tier rules.");
    } finally {
      setSaving("");
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={saving === "seed"} onClick={() => void seedTierRules()}>
          {saving === "seed" ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
          Seed holder tier rules
        </Button>
        <p className="text-xs text-muted-foreground">Node 250k/7d · Validator 500k/14d · Core 1M/30d</p>
      </div>
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-2">
        <h4 className="text-sm font-semibold">Tier economics (read-only)</h4>
        <p className="text-xs text-muted-foreground">
          Referral multiplier and bounty fee-share from <code className="text-[10px]">AR_HOLDER_TIERS</code> — used by
          referral payouts and bounty completion.
        </p>
        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          {AR_HOLDER_TIERS.map((t) => (
            <div key={t.id} className="rounded-lg border border-border/50 bg-background/40 px-3 py-2">
              <p className="font-semibold text-foreground">{t.label}</p>
              <p className="mt-1 text-muted-foreground">
                Referral <span className="font-mono text-foreground">{t.referralMultiplier}x</span>
              </p>
              <p className="text-muted-foreground">
                Bounty fee-share <span className="font-mono text-foreground">{t.bountyFeeSharePct}%</span>
              </p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="font-semibold">Perk rules</h3>
        <p className="text-sm text-muted-foreground">
          Define thresholds: when a wallet meets the stake amount + lock duration, the linked perk is automatically
          unlocked. Rules can be changed any time — changes take effect on the next perk check.
        </p>
      </div>
      {feedback && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm text-primary">{feedback}</div>
      )}
      <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
        <h4 className="text-sm font-medium">{form.id ? "Edit rule" : "Add rule"}</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Rule name</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Bronze staker — 1 000 tokens 7 days" />
          </div>
          <div className="space-y-1.5">
            <Label>Target perk</Label>
            {perks.length > 0 ? (
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.perkSlug}
                onChange={(e) => setForm((f) => ({ ...f, perkSlug: e.target.value }))}
              >
                <option value="">— select perk —</option>
                <optgroup label="Holder page tiers">
                  {HOLDER_TIER_RULE_OPTIONS.map((p) => (
                    <option key={p.slug} value={p.slug}>{p.title} ({p.slug})</option>
                  ))}
                </optgroup>
                <optgroup label="Token perks">
                {perks.map((p) => (
                  <option key={p.slug} value={p.slug}>{p.title} ({p.slug})</option>
                ))}
                </optgroup>
              </select>
            ) : (
              <Input value={form.perkSlug} onChange={(e) => setForm((f) => ({ ...f, perkSlug: e.target.value }))} placeholder="perk-slug" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Min stake (raw base units)</Label>
            <Input
              value={form.minStakeRaw}
              onChange={(e) => setForm((f) => ({ ...f, minStakeRaw: e.target.value }))}
              placeholder="e.g. 1000000000 (= 1 000 tokens × 10⁶)"
            />
            <p className="text-xs text-muted-foreground">
              Raw integer: 18 decimals for $AR holder tiers (1 token = 10^18 raw); 6 decimals for typical pump.fun mints (1 token = 10^6 raw). Enter 0 for any amount.
            </p>
            <p className="text-xs font-medium text-foreground">{formatRuleMinStakeRawUi(form.minStakeRaw)}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Min lock duration (days)</Label>
            <Input
              type="number"
              min={0}
              value={form.minLockDays}
              onChange={(e) => setForm((f) => ({ ...f, minLockDays: Number.parseInt(e.target.value, 10) || 0 }))}
              placeholder="0 = any duration"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Priority (higher = evaluated first)</Label>
            <Input
              type="number"
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: Number.parseInt(e.target.value, 10) || 0 }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Active</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.isActive ? "true" : "false"}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value === "true" }))}
            >
              <option value="true">Active</option>
              <option value="false">Disabled</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={saveRule} disabled={saving === "rule"} className="gap-2">
            {saving === "rule" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {form.id ? "Update rule" : "Add rule"}
          </Button>
          {form.id && (
            <Button variant="ghost" onClick={() => setForm({ ...EMPTY_RULE })}>Cancel</Button>
          )}
        </div>
      </div>
      {loading && <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="size-4 animate-spin" /> Loading rules...</div>}
      {!loading && rules.length === 0 && <p className="text-sm text-muted-foreground">No rules yet. Add one above.</p>}
      {!loading && rules.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Perk</th>
                <th className="px-3 py-2 text-right font-medium">Min stake (raw)</th>
                <th className="px-3 py-2 text-right font-medium">≈ $AR (18d)</th>
                <th className="px-3 py-2 text-right font-medium">Min lock</th>
                <th className="px-3 py-2 text-right font-medium">Priority</th>
                <th className="px-3 py-2 text-center font-medium">Active</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2 max-w-[160px] truncate">{rule.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-primary">{rule.perkSlug}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{rule.minStakeRaw}</td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">{formatRuleMinStakeRawUi(rule.minStakeRaw)}</td>
                  <td className="px-3 py-2 text-right">{formatDays(rule.minLockDays * 86400)}</td>
                  <td className="px-3 py-2 text-right">{rule.priority}</td>
                  <td className="px-3 py-2 text-center">{rule.isActive ? "✓" : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => editRule(rule)}>Edit</Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => deleteRule(rule.id)}><Trash2 className="size-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
// ---------------------------------------------------------------------------
// Sub-section: Stake Positions
// ---------------------------------------------------------------------------
function StakePositionsSection({
  initialData,
}: Readonly<{
  initialData: {
    positions: AdminStakePositionDto[];
    total: number;
    perkSummaryByWallet?: Record<string, string[]>;
  };
}>) {
  const [walletFilter, setWalletFilter] = useState("");
  const [saving, setSaving] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState({
    wallet: "",
    poolAddress: "",
    amountRaw: "0",
    amountUi: "0",
    nonce: "0",
    durationSec: "0",
    txSignature: "",
    adminNote: "",
  });
  const normalizedWalletFilter = walletFilter.trim();
  const positionsQuery = useQuery({
    queryKey: ["admin", "ar-token", "stake-positions", normalizedWalletFilter],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ pageSize: "50", includePerkSummary: "1" });
      if (normalizedWalletFilter) params.set("wallet", normalizedWalletFilter);
      const res = await fetch(`/api/admin/ar-token/stake-positions?${params}`, {
        credentials: "include",
        signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Unable to load stake positions");
      return (await res.json()) as {
        positions: AdminStakePositionDto[];
        total: number;
        perkSummaryByWallet?: Record<string, string[]>;
      };
    },
    initialData: normalizedWalletFilter ? undefined : initialData,
    staleTime: 12_000,
    retry: 1,
    refetchInterval: 12_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const positions = positionsQuery.data?.positions ?? [];
  const total = positionsQuery.data?.total ?? 0;
  const perkSummaryByWallet = positionsQuery.data?.perkSummaryByWallet ?? {};
  const lastRefreshAt = positionsQuery.dataUpdatedAt || null;
  const loading = positionsQuery.isPending || positionsQuery.isFetching;
  const refetchPositions = positionsQuery.refetch;
  const load = useCallback(async () => {
    await refetchPositions();
  }, [refetchPositions]);
  function slugSummaryForWallet(wallet: string): string {
    const slugs = perkSummaryByWallet[wallet];
    if (!slugs?.length) return "—";
    return slugs.join(", ");
  }
  async function saveManual() {
    setSaving("manual");
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ar-token/stake-positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...manualForm, nonce: Number(manualForm.nonce), durationSec: Number(manualForm.durationSec), source: "manual" }),
      });
      if (!res.ok) throw new Error("Save failed");
      setFeedback("Position saved.");
      await load();
    } catch {
      setFeedback("Failed to save position.");
    } finally {
      setSaving("");
    }
  }
  async function patchStatus(id: string, status: string) {
    await fetch("/api/admin/ar-token/stake-positions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id, status }),
    });
    await load();
  }
  async function deletePosition(id: string) {
    if (!confirm("Delete this position record?")) return;
    await fetch("/api/admin/ar-token/stake-positions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id }),
    });
    await load();
  }
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Stake positions</h3>
        <p className="text-sm text-muted-foreground">
          Positions indexed from on-chain Streamflow accounts or reported by clients after staking. Once the token is live
          and the pool is configured, the scheduled staking job can sync these from chain.
        </p>
      </div>
      {feedback && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm text-primary">{feedback}</div>
      )}
      <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
        <h4 className="text-sm font-medium">Manually add / backfill position</h4>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Wallet</Label>
            <Input value={manualForm.wallet} onChange={(e) => setManualForm((f) => ({ ...f, wallet: e.target.value }))} placeholder="Solana pubkey" />
          </div>
          <div className="space-y-1.5">
            <Label>Pool address</Label>
            <Input value={manualForm.poolAddress} onChange={(e) => setManualForm((f) => ({ ...f, poolAddress: e.target.value }))} placeholder="Streamflow pool pubkey" />
          </div>
          <div className="space-y-1.5">
            <Label>Amount (raw base units)</Label>
            <Input value={manualForm.amountRaw} onChange={(e) => setManualForm((f) => ({ ...f, amountRaw: e.target.value }))} placeholder="1000000000" />
          </div>
          <div className="space-y-1.5">
            <Label>Amount (UI / human)</Label>
            <Input value={manualForm.amountUi} onChange={(e) => setManualForm((f) => ({ ...f, amountUi: e.target.value }))} placeholder="1000" />
          </div>
          <div className="space-y-1.5">
            <Label>Duration (seconds)</Label>
            <Input value={manualForm.durationSec} onChange={(e) => setManualForm((f) => ({ ...f, durationSec: e.target.value }))} placeholder="604800 = 7 days" />
          </div>
          <div className="space-y-1.5">
            <Label>Nonce</Label>
            <Input value={manualForm.nonce} onChange={(e) => setManualForm((f) => ({ ...f, nonce: e.target.value }))} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label>TX signature</Label>
            <Input value={manualForm.txSignature} onChange={(e) => setManualForm((f) => ({ ...f, txSignature: e.target.value }))} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label>Admin note</Label>
            <Input value={manualForm.adminNote} onChange={(e) => setManualForm((f) => ({ ...f, adminNote: e.target.value }))} placeholder="Optional" />
          </div>
        </div>
        <Button onClick={saveManual} disabled={saving === "manual"} className="gap-2">
          {saving === "manual" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add position
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          <Input
            value={walletFilter}
            onChange={(e) => setWalletFilter(e.target.value)}
            placeholder="Filter by wallet address"
            className="max-w-sm"
          />
          <Button variant="outline" onClick={() => void load()} className="gap-2">
            <Search className="size-4" /> Search
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void load()}><RefreshCw className="size-4" /></Button>
        </div>
        <span className="rounded-full border border-primary/25 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
          Live · auto-refresh ~12s
        </span>
        {lastRefreshAt != null ? (
          <span className="text-xs text-muted-foreground">Last fetch {new Date(lastRefreshAt).toLocaleTimeString()}</span>
        ) : null}
      </div>
      {loading && <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="size-4 animate-spin" /> Loading positions...</div>}
      {!loading && positions.length === 0 && <p className="text-sm text-muted-foreground">No positions found.</p>}
      {!loading && positions.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">Showing {positions.length} of {total}</p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs">
                  <th className="px-3 py-2 text-left font-medium">Wallet</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">Duration</th>
                  <th className="px-3 py-2 text-right font-medium">Unlock at</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                  <th className="px-3 py-2 text-left font-medium">Unlocked slugs</th>
                  <th className="px-3 py-2 text-right font-medium">Synced</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr key={pos.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs max-w-[140px] truncate" title={pos.wallet}>{pos.wallet.slice(0, 8)}…{pos.wallet.slice(-4)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{pos.amountUi || pos.amountRaw}</td>
                    <td className="px-3 py-2 text-right">{formatDays(pos.durationSec)}</td>
                    <td className="px-3 py-2 text-right">{shortDate(pos.lockEndAt)}</td>
                    <td className="px-3 py-2 text-center"><StatusBadge status={pos.status} /></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{pos.source}</td>
                    <td
                      className="px-3 py-2 max-w-[220px] truncate font-mono text-[11px] text-primary"
                      title={slugSummaryForWallet(pos.wallet)}
                    >
                      {slugSummaryForWallet(pos.wallet)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">{shortDate(pos.lastSyncedAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {pos.status === "active" ? (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-amber-400" onClick={() => patchStatus(pos.id, "unstaked")}>Unstake</Button>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => patchStatus(pos.id, "active")}>Reactivate</Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => deletePosition(pos.id)}><Trash2 className="size-3" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
// ---------------------------------------------------------------------------
// Sub-section: Perk Overrides
// ---------------------------------------------------------------------------
function PerkOverridesSection({
  perks,
  initialOverrides,
}: Readonly<{
  perks: Array<{ slug: string; title: string }>;
  initialOverrides: AdminStakePerkOverrideDto[];
}>) {
  const [overrides, setOverrides] = useState<AdminStakePerkOverrideDto[]>(initialOverrides);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [walletFilter, setWalletFilter] = useState("");
  const [previewWallet, setPreviewWallet] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [form, setForm] = useState({
    wallet: "",
    perkSlug: "",
    overrideType: "force_unlock",
    adminNote: "",
    expiresAt: "",
  });
  const load = useCallback(async (wallet = walletFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (wallet.trim()) params.set("wallet", wallet.trim());
      const res = await fetch(`/api/admin/ar-token/stake-overrides?${params}`, { credentials: "include" });
      const data = (await res.json()) as { overrides: AdminStakePerkOverrideDto[] };
      setOverrides(data.overrides ?? []);
    } finally {
      setLoading(false);
    }
  }, [walletFilter]);
  async function saveOverride() {
    setSaving("override");
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ar-token/stake-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Save failed");
      setFeedback("Override saved.");
      setForm({ wallet: "", perkSlug: "", overrideType: "force_unlock", adminNote: "", expiresAt: "" });
      await load();
    } catch {
      setFeedback("Failed to save override.");
    } finally {
      setSaving("");
    }
  }
  async function deleteOverride(id: string) {
    if (!confirm("Remove this override?")) return;
    await fetch("/api/admin/ar-token/stake-overrides", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id }),
    });
    await load();
  }
  async function runPreview() {
    if (!previewWallet.trim()) return;
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await fetch(`/api/admin/ar-token/stake-perks-preview?wallet=${previewWallet.trim()}`, { credentials: "include" });
      const data = (await res.json()) as PreviewResult;
      setPreview(data);
    } finally {
      setPreviewLoading(false);
    }
  }
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Perk overrides</h3>
        <p className="text-sm text-muted-foreground">
          Force-unlock or force-lock a specific perk for a specific wallet, bypassing the stake rules. Useful for early
          access, banning, testing, or manual grants. Overrides can optionally expire.
        </p>
      </div>
      {feedback && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm text-primary">{feedback}</div>
      )}
      <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
        <h4 className="text-sm font-medium">Add / update override</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Wallet</Label>
            <Input value={form.wallet} onChange={(e) => setForm((f) => ({ ...f, wallet: e.target.value }))} placeholder="Solana pubkey" />
          </div>
          <div className="space-y-1.5">
            <Label>Perk</Label>
            {perks.length > 0 ? (
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.perkSlug}
                onChange={(e) => setForm((f) => ({ ...f, perkSlug: e.target.value }))}
              >
                <option value="">— select perk —</option>
                {perks.map((p) => <option key={p.slug} value={p.slug}>{p.title} ({p.slug})</option>)}
              </select>
            ) : (
              <Input value={form.perkSlug} onChange={(e) => setForm((f) => ({ ...f, perkSlug: e.target.value }))} placeholder="perk-slug" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Override type</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.overrideType}
              onChange={(e) => setForm((f) => ({ ...f, overrideType: e.target.value }))}
            >
              <option value="force_unlock">Force unlock (grant access regardless of stake)</option>
              <option value="force_lock">Force lock (deny access regardless of stake)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Expires at (optional)</Label>
            <Input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Admin note</Label>
            <Input value={form.adminNote} onChange={(e) => setForm((f) => ({ ...f, adminNote: e.target.value }))} placeholder="Reason for override" />
          </div>
        </div>
        <Button onClick={saveOverride} disabled={saving === "override"} className="gap-2">
          {saving === "override" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save override
        </Button>
      </div>
      <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
        <h4 className="text-sm font-medium">Preview computed perks for wallet</h4>
        <p className="text-xs text-muted-foreground">Shows which perks a wallet would receive from staking rules + overrides right now.</p>
        <div className="flex gap-2">
          <Input
            value={previewWallet}
            onChange={(e) => setPreviewWallet(e.target.value)}
            placeholder="Wallet address"
            className="max-w-sm"
          />
          <Button variant="outline" onClick={runPreview} disabled={previewLoading} className="gap-2">
            {previewLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Preview
          </Button>
        </div>
        {preview && (
          <div className="space-y-2 text-sm">
            <p className="font-medium">
              Unlocked perks:{" "}
              {preview.unlockedPerks.length > 0
                ? preview.unlockedPerks.map((s) => (
                    <span key={s} className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{s}</span>
                  ))
                : <span className="text-muted-foreground">none</span>}
            </p>
            <p className="text-muted-foreground">
              Active positions: {preview.activePositions.length} |{" "}
              Rules applied: {preview.appliedRules.length} |{" "}
              Overrides: {preview.appliedOverrides.length}
            </p>
            {preview.appliedRules.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
                {preview.appliedRules.map((r) => (
                  <li key={r.ruleId}>{r.ruleName} → <span className="text-primary">{r.perkSlug}</span></li>
                ))}
              </ul>
            )}
            {preview.appliedOverrides.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
                {preview.appliedOverrides.map((o) => (
                  <li key={`${o.perkSlug}-${o.overrideType}`}>
                    <span className={o.overrideType === "force_unlock" ? "text-green-400" : "text-destructive"}>
                      {o.overrideType === "force_unlock" ? <Unlock className="inline size-3 mr-0.5" /> : <Lock className="inline size-3 mr-0.5" />}
                      {o.overrideType}
                    </span>{" "}
                    {o.perkSlug}
                    {o.adminNote ? ` — ${o.adminNote}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={walletFilter}
          onChange={(e) => setWalletFilter(e.target.value)}
          placeholder="Filter overrides by wallet"
          className="max-w-sm"
        />
        <Button variant="outline" onClick={() => load(walletFilter)} className="gap-2">
          <Search className="size-4" /> Filter
        </Button>
        <Button variant="ghost" size="icon" onClick={() => load("")}><RefreshCw className="size-4" /></Button>
      </div>
      {loading && <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="size-4 animate-spin" /> Loading overrides...</div>}
      {!loading && overrides.length === 0 && <p className="text-sm text-muted-foreground">No overrides found.</p>}
      {!loading && overrides.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="px-3 py-2 text-left font-medium">Wallet</th>
                <th className="px-3 py-2 text-left font-medium">Perk</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Note</th>
                <th className="px-3 py-2 text-right font-medium">Expires</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((ov) => (
                <tr key={ov.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs max-w-[120px] truncate" title={ov.wallet}>{ov.wallet.slice(0, 8)}…</td>
                  <td className="px-3 py-2 font-mono text-xs text-primary">{ov.perkSlug}</td>
                  <td className="px-3 py-2">
                    {ov.overrideType === "force_unlock"
                      ? <span className="flex items-center gap-1 text-green-400 text-xs"><Unlock className="size-3" /> unlock</span>
                      : <span className="flex items-center gap-1 text-destructive text-xs"><Lock className="size-3" /> lock</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[160px] truncate">{ov.adminNote || "—"}</td>
                  <td className="px-3 py-2 text-right text-xs">{ov.expiresAt ? shortDate(ov.expiresAt) : "Never"}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => deleteOverride(ov.id)}><Trash2 className="size-3" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
// ---------------------------------------------------------------------------
// Sub-section: Holder allocations
// ---------------------------------------------------------------------------
export interface AdminHolderAllocationDto {
  id: string;
  wallet: string;
  agentId: number;
  agentName: string | null;
  perkType: string;
  tierId: string;
  boostUnits: number;
  status: string;
  periodKey: string;
  expiresAt: string | null;
  updatedAt: string;
}
function HolderAllocationsSection({ initialAllocations }: Readonly<{ initialAllocations: AdminHolderAllocationDto[] }>) {
  const [walletFilter, setWalletFilter] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [grantForm, setGrantForm] = useState({
    wallet: "",
    agentDbId: "",
    perkType: "power_boost",
    tierId: "validator",
  });
  const normalizedWalletFilter = walletFilter.trim();
  const loadAllocations = useCallback(async (signal: AbortSignal): Promise<AdminHolderAllocationDto[]> => {
    const query = normalizedWalletFilter ? `?wallet=${encodeURIComponent(normalizedWalletFilter)}` : "";
    const response = await fetch(`/api/admin/ar-token/holder-allocations${query}`, {
      credentials: "include",
      signal,
    });
    if (!response.ok) throw new Error("Could not load holder allocations");
    const data = (await response.json()) as { allocations?: AdminHolderAllocationDto[] };
    return data.allocations ?? [];
  }, [normalizedWalletFilter]);
  const allocationsQuery = useQuery({
    queryKey: adminKeys.arTokenHolderAllocations({ wallet: normalizedWalletFilter }),
    queryFn: ({ signal }) => loadAllocations(signal),
    initialData: normalizedWalletFilter ? undefined : initialAllocations,
    refetchOnMount: false,
  });
  const rows = allocationsQuery.data ?? [];
  const loading = allocationsQuery.isPending;
  const refreshAllocations = () => void allocationsQuery.refetch();
  async function revoke(id: string) {
    if (!confirm("Revoke this allocation?")) return;
    await fetch(`/api/admin/ar-token/holder-allocations?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    setFeedback("Allocation revoked.");
    refreshAllocations();
  }
  async function grant() {
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/ar-token/holder-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          wallet: grantForm.wallet,
          agentDbId: Number(grantForm.agentDbId),
          perkType: grantForm.perkType,
          tierId: grantForm.tierId,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Grant failed");
      setFeedback("Allocation granted.");
      refreshAllocations();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Grant failed");
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs">Filter by wallet</Label>
          <Input
            value={walletFilter}
            onChange={(e) => setWalletFilter(e.target.value)}
            placeholder="Solana wallet (optional)"
            className="mt-1 font-mono text-xs"
          />
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={refreshAllocations} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Refresh
        </Button>
      </div>
      <div className="rounded-lg border border-border p-4 space-y-3">
        <p className="text-sm font-medium">Manual grant</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            placeholder="Wallet"
            value={grantForm.wallet}
            onChange={(e) => setGrantForm((f) => ({ ...f, wallet: e.target.value }))}
            className="font-mono text-xs"
          />
          <Input
            placeholder="Agent DB id"
            value={grantForm.agentDbId}
            onChange={(e) => setGrantForm((f) => ({ ...f, agentDbId: e.target.value }))}
          />
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={grantForm.perkType}
            onChange={(e) => setGrantForm((f) => ({ ...f, perkType: e.target.value }))}
          >
            <option value="power_boost">power_boost</option>
            <option value="stake_badge">stake_badge</option>
          </select>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={grantForm.tierId}
            onChange={(e) => setGrantForm((f) => ({ ...f, tierId: e.target.value }))}
          >
            <option value="node">node</option>
            <option value="validator">validator</option>
            <option value="core">core</option>
          </select>
        </div>
        <Button type="button" size="sm" onClick={() => void grant()}>
          <Plus className="size-3.5 mr-1" /> Grant allocation
        </Button>
      </div>
      {feedback ? <p className="text-sm text-muted-foreground">{feedback}</p> : null}
      {rows.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground">No holder allocations found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left">Wallet</th>
                <th className="px-3 py-2 text-left">Agent</th>
                <th className="px-3 py-2 text-left">Perk</th>
                <th className="px-3 py-2 text-left">Tier</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Expires</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/50">
                  <td className="px-3 py-2 font-mono text-xs max-w-[100px] truncate" title={row.wallet}>
                    {row.wallet.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.agentName ?? `#${row.agentId}`}
                  </td>
                  <td className="px-3 py-2 text-xs">{row.perkType}</td>
                  <td className="px-3 py-2 text-xs">{row.tierId}</td>
                  <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                  <td className="px-3 py-2 text-xs">{shortDate(row.expiresAt)}</td>
                  <td className="px-3 py-2 text-right">
                    {row.status === "active" ? (
                      <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => void revoke(row.id)}>
                        <Trash2 className="size-3" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export type StakingAdminSection = "rules" | "positions" | "overrides" | "allocations";
export function AdminStakingTab({
  perks,
  initialSection = "rules",
  initialRules,
  initialPositions,
  initialOverrides,
  initialAllocations,
}: Readonly<{
  perks: Array<{ slug: string; title: string }>;
  initialSection?: StakingAdminSection;
  initialRules: AdminStakePerkRuleDto[];
  initialPositions: {
    positions: AdminStakePositionDto[];
    total: number;
    perkSummaryByWallet?: Record<string, string[]>;
  };
  initialOverrides: AdminStakePerkOverrideDto[];
  initialAllocations: AdminHolderAllocationDto[];
}>) {
  const [section, setSection] = useState<StakingAdminSection>(initialSection);
  return (
    <section className="space-y-6 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">Staking rules &amp; perks</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure how staked token amounts map to perks, view per-wallet positions indexed from Streamflow, and apply
          admin overrides to grant or revoke access regardless of stake.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-muted/20 p-2">
        {(
          [
            ["rules", "Perk rules"],
            ["positions", "Stake positions"],
            ["overrides", "Overrides & preview"],
            ["allocations", "Holder allocations"],
          ] as const
        ).map(([id, label]) => (
          <Button key={id} size="sm" variant={section === id ? "default" : "ghost"} onClick={() => setSection(id)}>
            {label}
          </Button>
        ))}
      </div>
      {section === "rules" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">How it works</p>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li>User stakes $AR via Streamflow on the staking page → position is reported here automatically.</li>
              <li>Rules are evaluated: if a wallet has an active position meeting the minimum stake + lock duration, that perk is unlocked.</li>
              <li>Admin overrides always win: you can grant or deny any perk regardless of stake amount.</li>
              <li>Use overrides → Preview to see exactly what a wallet would receive right now.</li>
            </ol>
          </div>
          <PerkRulesSection perks={perks} initialRules={initialRules} />
        </div>
      )}
      {section === "positions" && (
        <StakePositionsSection
          initialData={initialPositions}
        />
      )}
      {section === "overrides" && (
        <PerkOverridesSection perks={perks} initialOverrides={initialOverrides} />
      )}
      {section === "allocations" && (
        <HolderAllocationsSection initialAllocations={initialAllocations} />
      )}
    </section>
  );
}
