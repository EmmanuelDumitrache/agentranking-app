"use client";
import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { Users, Search, Plus, Edit2, RefreshCw, X, Check, Loader2, ChevronUp, BadgeCheck, Clock, AlertCircle, Mail, KeyRound, Bot, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminKeys } from "@/lib/query-keys/admin";
import type {
  AdminAccountAgentsResponse,
  AdminAccountDto as Account,
  AdminAccountsResponse,
} from "@/lib/admin/identity/types";
import { adminAccountsResourceKey, type AdminAccountsQuery } from "@/lib/admin/identity/query";
const SUB_STATUS_STYLES: Record<string, { label: string; class: string; icon: LucideIcon }> = {
  active: { label: "Active", class: "bg-green-500/10 text-green-400 border-green-500/20", icon: BadgeCheck },
  pending: { label: "Pending", class: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: Clock },
  expired: { label: "Expired", class: "bg-red-500/10 text-red-400 border-red-500/20", icon: AlertCircle },
  cancelled: { label: "Cancelled", class: "bg-muted text-muted-foreground border-border", icon: X },
  none: { label: "None", class: "bg-muted text-muted-foreground border-border", icon: X },
};
function SubStatusBadge({ status }: { status: string }) {
  const s = SUB_STATUS_STYLES[status] ?? SUB_STATUS_STYLES.none;
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border", s.class)}>
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  );
}
interface EditFields {
  email: string;
  walletAddress: string;
  displayName: string;
  password: string;
  subscriptionStatus: string;
  subscriptionPlan: string;
  subscriptionExpiresAt: string;
  adminNotes: string;
}
function EditForm({ account, onSave, onCancel }: {
  account: Account;
  onSave: (updated: Account) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<EditFields>({
    email: account.email ?? "",
    walletAddress: account.walletAddress ?? "",
    displayName: account.displayName ?? "",
    password: "",
    subscriptionStatus: account.subscriptionStatus,
    subscriptionPlan: account.subscriptionPlan,
    subscriptionExpiresAt: account.subscriptionExpiresAt
      ? new Date(account.subscriptionExpiresAt).toISOString().slice(0, 10)
      : "",
    adminNotes: account.adminNotes,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function update<K extends keyof EditFields>(k: K, v: EditFields[K]) {
    setFields((prev) => ({ ...prev, [k]: v }));
  }
  async function save() {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        email: fields.email || undefined,
        walletAddress: fields.walletAddress || undefined,
        displayName: fields.displayName || undefined,
        subscriptionStatus: fields.subscriptionStatus,
        subscriptionPlan: fields.subscriptionPlan,
        subscriptionExpiresAt: fields.subscriptionExpiresAt || null,
        adminNotes: fields.adminNotes,
      };
      if (fields.password) body.password = fields.password;
      const res = await fetch(`/api/admin/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { account?: Account; error?: string };
      if (!res.ok || !data.account) {
        setError(data.error ?? "Failed to save.");
        return;
      }
      onSave(data.account);
    } finally {
      setSaving(false);
    }
  }
  async function resetClaim() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetClaimToken: true }),
      });
      const data = await res.json() as { account?: Account; error?: string };
      if (!res.ok || !data.account) {
        setError(data.error ?? "Failed to reset.");
        return;
      }
      onSave(data.account);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="border-t border-border pt-4 mt-3 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Email</Label>
          <Input value={fields.email} onChange={(e) => update("email", e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Wallet</Label>
          <Input value={fields.walletAddress} onChange={(e) => update("walletAddress", e.target.value)} className="h-8 text-xs font-mono" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Display Name</Label>
          <Input value={fields.displayName} onChange={(e) => update("displayName", e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">New Password (optional)</Label>
          <Input type="password" value={fields.password} onChange={(e) => update("password", e.target.value)} placeholder="Leave blank to keep" className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Subscription Status</Label>
          <select
            className="w-full h-8 rounded border border-border bg-background text-xs px-2"
            value={fields.subscriptionStatus}
            onChange={(e) => update("subscriptionStatus", e.target.value)}
          >
            {["none", "pending", "active", "expired", "cancelled"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Plan</Label>
          <select
            className="w-full h-8 rounded border border-border bg-background text-xs px-2"
            value={fields.subscriptionPlan}
            onChange={(e) => update("subscriptionPlan", e.target.value)}
          >
            <option value="">—</option>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Expires At</Label>
          <Input type="date" value={fields.subscriptionExpiresAt} onChange={(e) => update("subscriptionExpiresAt", e.target.value)} className="h-8 text-xs" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Admin Notes</Label>
        <textarea
          value={fields.adminNotes}
          onChange={(e) => update("adminNotes", e.target.value)}
          className="w-full rounded border border-border bg-background text-xs px-2 py-1.5 h-16 resize-none"
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} className="rounded-full text-xs">
          <X className="h-3 w-3 mr-1" /> Cancel
        </Button>
        <Button size="sm" variant="outline" onClick={resetClaim} disabled={saving} className="rounded-full text-xs">
          <RefreshCw className="h-3 w-3 mr-1" /> Reset Claim Link
        </Button>
        <Button size="sm" onClick={save} disabled={saving} className="rounded-full text-xs">
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
          Save
        </Button>
      </div>
    </div>
  );
}
function AgentsPanel({ accountId, onClose }: { accountId: number; onClose: () => void }) {
  const agentsQuery = useQuery({
    queryKey: adminKeys.accountAgents(accountId),
    queryFn: async ({ signal }): Promise<AdminAccountAgentsResponse> => {
      const response = await fetch(`/api/admin/accounts/${accountId}/agents`, { signal });
      const payload = (await response.json()) as AdminAccountAgentsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load agents.");
      return payload;
    },
  });
  const agents = agentsQuery.data?.ownedAgents ?? [];
  const loading = agentsQuery.isPending;
  const error = agentsQuery.error?.message ?? "";
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Bot className="h-4 w-4" /> Owned agents
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <p className="text-xs text-red-400">{error}</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No owned agents.</p>
        ) : (
          <ul className="space-y-2">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{a.name ?? a.agentId}</p>
                  <p className="text-xs text-muted-foreground font-mono">{a.chainId}:{a.agentId}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {a.isVerified && (
                    <span className="text-[10px] text-green-400 border border-green-500/30 rounded px-1">verified</span>
                  )}
                  <Link href={a.dashboardPath} target="_blank" className="text-xs text-primary hover:underline">
                    Dashboard
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
function AccountActions({ account }: { account: Account }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showAgents, setShowAgents] = useState(false);
  async function runAction(key: string, url: string, body?: Record<string, unknown>) {
    setBusy(key);
    setMessage("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) {
        setMessage(data.error ?? "Action failed.");
        return;
      }
      setMessage("Done.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {account.email && !account.emailVerifiedAt && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full text-xs"
            disabled={busy !== null}
            onClick={() => runAction("confirm", `/api/admin/accounts/${account.id}/resend-confirm`)}
          >
            {busy === "confirm" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Mail className="h-3 w-3 mr-1" />}
            Resend confirm
          </Button>
        )}
        {account.email && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full text-xs"
            disabled={busy !== null}
            onClick={() => runAction("login", `/api/admin/accounts/${account.id}/resend-login-code`)}
          >
            {busy === "login" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <KeyRound className="h-3 w-3 mr-1" />}
            Send login code
          </Button>
        )}
        {account.totpEnabledAt ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full text-xs"
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm("Reset authenticator 2FA for this account?")) return;
              void runAction("reset-totp", `/api/admin/accounts/${account.id}/security/reset-totp`);
            }}
          >
            {busy === "reset-totp" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Reset 2FA
          </Button>
        ) : null}
        {account.emailOtpMfaEnabledAt ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full text-xs"
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm("Disable email MFA for this account?")) return;
              void runAction(
                "disable-email-mfa",
                `/api/admin/accounts/${account.id}/security/disable-email-mfa`,
              );
            }}
          >
            {busy === "disable-email-mfa" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Disable email MFA
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="h-7 rounded-full text-xs"
          onClick={() => setShowAgents(true)}
        >
          <Bot className="h-3 w-3 mr-1" /> View agents
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 rounded-full text-xs"
          disabled={busy !== null}
          onClick={() => {
            const pwd = window.prompt("Set new password (min 8 chars), or leave empty to clear:");
            if (pwd === null) return;
            if (pwd === "") {
              void runAction("reset", `/api/admin/accounts/${account.id}/reset-password`, { clear: true });
            } else {
              void runAction("reset", `/api/admin/accounts/${account.id}/reset-password`, { password: pwd });
            }
          }}
        >
          Reset password
        </Button>
      </div>
      {message && <p className="text-xs text-muted-foreground mt-1">{message}</p>}
      {showAgents && <AgentsPanel accountId={account.id} onClose={() => setShowAgents(false)} />}
    </>
  );
}
function CreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (a: Account) => void }) {
  const [email, setEmail] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("pending");
  const [plan, setPlan] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    if (!email) { setError("Email required."); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, walletAddress, displayName, subscriptionStatus: status, subscriptionPlan: plan }),
      });
      const data = await res.json() as { account?: Account; error?: string };
      if (!res.ok || !data.account) {
        setError(data.error ?? "Failed.");
        return;
      }
      onCreate(data.account);
      onClose();
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Create Account</h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Email *</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Wallet Address</Label>
            <Input value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} placeholder="0x…" className="h-8 text-xs font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Display Name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <select className="w-full h-8 rounded border border-border bg-background text-xs px-2" value={status} onChange={(e) => setStatus(e.target.value)}>
                {["none", "pending", "active", "expired"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Plan</Label>
              <select className="w-full h-8 rounded border border-border bg-background text-xs px-2" value={plan} onChange={(e) => setPlan(e.target.value)}>
                <option value="">—</option>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
              </select>
            </div>
          </div>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <p className="text-xs text-muted-foreground">A claim link email will be sent automatically.</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose} className="rounded-full">Cancel</Button>
          <Button size="sm" onClick={create} disabled={saving} className="rounded-full">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            Create &amp; Send Link
          </Button>
        </div>
      </div>
    </div>
  );
}
export function AdminAccountsClient({
  initialData,
  initialQuery,
}: {
  readonly initialData: AdminAccountsResponse;
  readonly initialQuery: AdminAccountsQuery;
}) {
  const [page, setPage] = useState(initialQuery.page);
  const [search, setSearch] = useState(initialQuery.search);
  const [statusFilter, setStatusFilter] = useState(initialQuery.status);
  const [editing, setEditing] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();
  const initialResourceKey = adminAccountsResourceKey(initialQuery);
  const accountsQuery = useQuery({
    queryKey: adminKeys.accounts({
      page,
      perPage: initialQuery.perPage,
      query: search || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
    }),
    queryFn: async ({ signal }): Promise<AdminAccountsResponse> => {
      const params = new URLSearchParams({ page: String(page), perPage: String(initialQuery.perPage) });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const response = await fetch(`/api/admin/accounts?${params}`, { signal });
      if (!response.ok) throw new Error(`Could not load accounts (${response.status})`);
      return (await response.json()) as AdminAccountsResponse;
    },
    initialData:
      adminAccountsResourceKey({
        page,
        perPage: initialQuery.perPage,
        status: statusFilter,
        search,
      }) === initialResourceKey
        ? initialData
        : undefined,
    refetchOnMount: false,
    placeholderData: keepPreviousData,
  });
  const accounts = accountsQuery.data?.accounts ?? [];
  const total = accountsQuery.data?.total ?? 0;
  const totalPages = accountsQuery.data?.totalPages ?? 1;
  const loading = accountsQuery.isPending;
  const setAccountsData: (updater: (current: AdminAccountsResponse | undefined) => AdminAccountsResponse | undefined) => void =
    (updater) => {
      queryClient.setQueryData<AdminAccountsResponse>(
        adminKeys.accounts({
          page,
          perPage: initialQuery.perPage,
          query: search || undefined,
          status: statusFilter === "all" ? undefined : statusFilter,
        }),
        (current) => updater(current),
      );
    };
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" />
            Dashboard accounts
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} accounts total</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-1.5 rounded-full">
          <Plus className="h-4 w-4" /> Create Account
        </Button>
      </div>
      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search email, wallet, name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="h-8 pl-8 text-sm w-64"
          />
        </div>
        {(["all", "none", "pending", "active", "expired", "cancelled"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => { setStatusFilter(s); setPage(1); }}
            className="h-7 rounded-full text-xs capitalize"
          >
            {s}
          </Button>
        ))}
      </div>
      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No accounts found.</p>
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => {
            const isEditing = editing === account.id;
            return (
              <div key={account.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{account.displayName ?? account.email ?? "(no name)"}</span>
                      <SubStatusBadge status={account.subscriptionStatus} />
                      {account.subscriptionPlan && (
                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground capitalize">
                          {account.subscriptionPlan}
                        </span>
                      )}
                      <span className={cn(
                        "text-xs px-1.5 py-0.5 rounded border",
                        account.isClaimed
                          ? "bg-green-500/10 text-green-400 border-green-500/20"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                      )}>
                        {account.isClaimed ? "Claimed" : "Unclaimed"}
                      </span>
                      {account.email && (
                        <span className={cn(
                          "text-xs px-1.5 py-0.5 rounded border",
                          account.emailVerifiedAt
                            ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : "bg-muted text-muted-foreground border-border"
                        )}>
                          {account.emailVerifiedAt ? "Email verified" : "Email unverified"}
                        </span>
                      )}
                      {account.totpEnabledAt ? (
                        <span className="text-xs px-1.5 py-0.5 rounded border bg-sky-500/10 text-sky-400 border-sky-500/20">
                          2FA
                        </span>
                      ) : null}
                      {account.emailOtpMfaEnabledAt ? (
                        <span className="text-xs px-1.5 py-0.5 rounded border bg-sky-500/10 text-sky-400 border-sky-500/20">
                          Email MFA
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {account.email && (
                        <span className="text-xs text-muted-foreground">{account.email}</span>
                      )}
                      {account.lastLoginAt && (
                        <span className="text-xs text-muted-foreground">
                          Last login {new Date(account.lastLoginAt).toLocaleString()}
                        </span>
                      )}
                      {account.walletAddress && (
                        <span className="text-xs font-mono text-muted-foreground">
                          {account.walletAddress.slice(0, 6)}…{account.walletAddress.slice(-4)}
                        </span>
                      )}
                      {account.subscriptionExpiresAt && (
                        <span className="text-xs text-muted-foreground">
                          Expires {new Date(account.subscriptionExpiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    {account.hasClaimToken && !account.isClaimed ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        Claim email issued
                        {account.claimTokenExpiresAt
                          ? ` · expires ${new Date(account.claimTokenExpiresAt).toLocaleDateString()}`
                          : ""}
                      </p>
                    ) : null}
                    {account.adminNotes && (
                      <p className="text-xs text-amber-400/80 italic">Note: {account.adminNotes}</p>
                    )}
                    <AccountActions account={account} />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full text-xs gap-1 shrink-0"
                    onClick={() => setEditing(isEditing ? null : account.id)}
                  >
                    {isEditing ? <ChevronUp className="h-3 w-3" /> : <Edit2 className="h-3 w-3" />}
                    {isEditing ? "Close" : "Edit"}
                  </Button>
                </div>
                {isEditing && (
                  <EditForm
                    account={account}
                    onSave={(updated) => {
                      setAccountsData((current) => current ? {
                        ...current,
                        accounts: current.accounts.map((account) =>
                          account.id === updated.id ? { ...account, ...updated } : account,
                        ),
                      } : current);
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
        </div>
      )}
      {/* Create modal */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreate={(account) => setAccountsData((current) => current ? {
            ...current,
            accounts: [account, ...current.accounts],
            total: current.total + 1,
          } : { accounts: [account], total: 1, page: 1, perPage: 25, totalPages: 1 })}
        />
      )}
    </div>
  );
}
