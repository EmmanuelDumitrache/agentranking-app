"use client";
import { useState, useCallback, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import { useDebounce } from "@/hooks/use-debounce";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { truncateAddress } from "@/lib/utils";
import { Search, ChevronLeft, ChevronRight, ExternalLink, Trash2, Bot, Loader2 } from "lucide-react";
import type {
  AdminEmailAgentsResponse,
  AdminUserAgentsResponse as UserAgentsPayload,
  AdminUsersResponse as UsersData,
} from "@/lib/admin/identity/types";
import { adminUsersResourceKey, type AdminUsersQuery } from "@/lib/admin/identity/query";
export function AdminUsersClient({
  initialData,
  initialQuery,
}: {
  readonly initialData: UsersData;
  readonly initialQuery: AdminUsersQuery;
}) {
  const [page, setPage] = useState(initialQuery.page);
  const [search, setSearch] = useState(initialQuery.search);
  const debouncedSearch = useDebounce(search, 400);
  const [clearingWallet, setClearingWallet] = useState<string | null>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [agentsWallet, setAgentsWallet] = useState<string | null>(null);
  const [localAgentsData, setLocalAgentsData] = useState<UserAgentsPayload | null>(null);
  const [attachAgentUrl, setAttachAgentUrl] = useState("");
  const [attachDbId, setAttachDbId] = useState("");
  const [attachChainId, setAttachChainId] = useState("");
  const [attachRegistryId, setAttachRegistryId] = useState("");
  const [attachReason, setAttachReason] = useState("");
  const [forceAttach, setForceAttach] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachLoading, setAttachLoading] = useState(false);
  const [ownerConflict, setOwnerConflict] = useState<{ previousOwner: string } | null>(null);
  const [emailLookup, setEmailLookup] = useState("");
  const loadUsers = useCallback(async (signal: AbortSignal): Promise<UsersData> => {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(initialQuery.perPage),
    });
    if (debouncedSearch) params.set("search", debouncedSearch);
    const response = await fetch(`/api/admin/users?${params}`, { signal });
    if (!response.ok) throw new Error(`Could not load users (${response.status})`);
    return (await response.json()) as UsersData;
  }, [debouncedSearch, initialQuery.perPage, page]);
  const resourceKey = adminUsersResourceKey({
    page,
    perPage: initialQuery.perPage,
    search: debouncedSearch,
  });
  const initialResourceKey = adminUsersResourceKey(initialQuery);
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: adminKeys.users({
      page,
      perPage: initialQuery.perPage,
      query: debouncedSearch || undefined,
    }),
    queryFn: ({ signal }) => loadUsers(signal),
    initialData: resourceKey === initialResourceKey ? initialData : undefined,
    refetchOnMount: false,
    placeholderData: keepPreviousData,
  });
  const data = usersQuery.data;
  const loading = usersQuery.isPending;
  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: adminKeys.users({}) });
  const loadWalletAgents = useCallback(async (signal: AbortSignal): Promise<UserAgentsPayload | null> => {
    if (!agentsOpen || !agentsWallet) return null;
    const response = await fetch(`/api/admin/users/${encodeURIComponent(agentsWallet)}/agents`, { signal });
    if (!response.ok) {
      throw new Error(response.status === 404 ? "Profile not found." : "Failed to load agents.");
    }
    return (await response.json()) as UserAgentsPayload;
  }, [agentsOpen, agentsWallet]);
  const agentsQuery = useQuery({
    queryKey: agentsOpen && agentsWallet ? adminKeys.userAgents(agentsWallet) : adminKeys.users({}),
    queryFn: ({ signal }) => loadWalletAgents(signal),
    enabled: Boolean(agentsOpen && agentsWallet),
  });
  const agentsData = localAgentsData ?? agentsQuery.data;
  const agentsLoading = agentsOpen && localAgentsData == null && agentsQuery.isPending;
  const refreshAgents = () => queryClient.invalidateQueries({ queryKey: agentsWallet ? adminKeys.userAgents(agentsWallet) : adminKeys.all });
  const clearProfile = async (wallet: string) => {
    if (!confirm(`Clear username/display name/bio for ${truncateAddress(wallet, 6)}?`)) return;
    setClearingWallet(wallet);
    try {
      await fetch(`/api/admin/users?wallet=${wallet}`, { method: "DELETE" });
      refreshUsers();
    } finally {
      setClearingWallet(null);
    }
  };
  const openAgentsByEmail = async (email: string) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setAgentsWallet(null);
    setLocalAgentsData(null);
    setAttachError(null);
    setOwnerConflict(null);
    setAgentsOpen(true);
    const response = await fetch(`/api/admin/users/by-email/${encodeURIComponent(normalized)}/agents`);
    const result = (await response.json()) as AdminEmailAgentsResponse & { error?: string };
    if (!response.ok) {
      setAttachError(result.error ?? "Lookup failed.");
      return;
    }
    setLocalAgentsData({
      wallet: result.wallet ?? "",
      ownedAgents: result.ownedAgents ?? result.dashboardAgents ?? [],
      dashboardAgents: result.dashboardAgents ?? result.ownedAgents ?? [],
      paidOrLinked: [],
      unlinkedPaidOrders: [],
    });
  };
  const openAgentsModal = (wallet: string) => {
    setAgentsWallet(wallet);
    setLocalAgentsData(null);
    setAttachAgentUrl("");
    setAttachDbId("");
    setAttachChainId("");
    setAttachRegistryId("");
    setAttachReason("");
    setForceAttach(false);
    setAttachError(null);
    setOwnerConflict(null);
    setAgentsOpen(true);
  };
  const submitAttach = async () => {
    if (!agentsWallet) return;
    const url = attachAgentUrl.trim();
    const hasUrl = url.length > 0;
    const chain = Number.parseInt(attachChainId.trim(), 10);
    const reg = Number.parseInt(attachRegistryId.trim(), 10);
    const useRegistry =
      !hasUrl && Number.isFinite(chain) && chain > 0 && Number.isFinite(reg) && reg >= 1;
    const id = Number.parseInt(attachDbId.trim(), 10);
    if (!hasUrl && !useRegistry && (!Number.isFinite(id) || id < 1)) {
      setAttachError(
        "Paste an agent profile URL, or internal DB id, or both chain id and registry id."
      );
      return;
    }
    setAttachLoading(true);
    setAttachError(null);
    try {
      const body: Record<string, unknown> = {
        force: forceAttach,
        reason: attachReason.trim() || undefined,
      };
      if (hasUrl) {
        body.agentUrl = url;
      } else if (useRegistry) {
        body.chainId = chain;
        body.registryAgentId = reg;
      } else {
        body.agentDbId = id;
      }
      const res = await fetch(`/api/admin/users/${encodeURIComponent(agentsWallet)}/attach-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 409) {
        const prev = typeof json.previousOwner === "string" ? json.previousOwner : "";
        setOwnerConflict({ previousOwner: prev });
        setAttachError("Another wallet owns this agent. Enable “Force attach” to take over ownership.");
        return;
      }
      if (!res.ok) {
        const err = typeof json.error === "string" ? json.error : "Attach failed.";
        const detail = typeof json.detail === "string" ? json.detail : "";
        const agent = json.agent as { dbId?: number; registryAgentId?: number; name?: string } | undefined;
        const agentHint =
          agent && typeof agent.dbId === "number"
            ? ` (row: db #${agent.dbId}, registry #${agent.registryAgentId ?? "?"}, ${agent.name ?? ""})`
            : "";
        setAttachError(detail ? `${err}${agentHint}\n${detail}` : `${err}${agentHint}`);
        return;
      }
      setAttachAgentUrl("");
      setAttachDbId("");
      setAttachChainId("");
      setAttachRegistryId("");
      setAttachReason("");
      setForceAttach(false);
      setOwnerConflict(null);
      refreshAgents();
      refreshUsers();
    } finally {
      setAttachLoading(false);
    }
  };
  const verificationBadges = (a: { isVerified: boolean; isPremiumVerified: boolean; isVerifiedRevenue: boolean }) => {
    const bits: string[] = [];
    if (a.isPremiumVerified) bits.push("Premium");
    if (a.isVerifiedRevenue) bits.push("Rev");
    if (a.isVerified) bits.push("Verified");
    if (bits.length === 0) bits.push("—");
    return bits.join(" · ");
  };
  let agentsModalBody: ReactNode;
  if (agentsLoading) {
    agentsModalBody = (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  } else if (agentsData) {
    agentsModalBody = (
      <div className="space-y-6 text-sm">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Owned agents ({agentsData.ownedAgents.length})
          </h3>
          {agentsData.ownedAgents.length === 0 ? (
            <p className="text-xs text-muted-foreground">None</p>
          ) : (
            <ul className="space-y-2 border border-border rounded-md divide-y divide-border">
              {agentsData.ownedAgents.map((a) => (
                <li key={a.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-xs">{a.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">
                      db #{a.id} · chain {a.chainId} · id {a.agentId} · {verificationBadges(a)}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                      <Link href={a.profileUrl} target="_blank">
                        Directory
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                      <Link href={a.dashboardPath} target="_blank">
                        Dashboard
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Paid / promotions ({agentsData.paidOrLinked.length})
          </h3>
          {agentsData.paidOrLinked.length === 0 ? (
            <p className="text-xs text-muted-foreground">None found</p>
          ) : (
            <ul className="space-y-2 border border-border rounded-md divide-y divide-border">
              {agentsData.paidOrLinked.map((a) => (
                <li key={a.id} className="px-3 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-xs">{a.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        db #{a.id} · {verificationBadges(a)}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {a.sources.join(", ")}
                        {a.isOwned ? (
                          <span className="text-emerald-600 dark:text-emerald-400"> · owned</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400"> · not owned</span>
                        )}
                      </p>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="h-7 text-xs shrink-0">
                      <Link href={a.profileUrl} target="_blank">
                        View
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        {agentsData.unlinkedPaidOrders.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Paid orders without linked agent ({agentsData.unlinkedPaidOrders.length})
            </h3>
            <ul className="text-[11px] text-muted-foreground font-mono space-y-1 border border-border rounded-md p-2">
              {agentsData.unlinkedPaidOrders.map((o) => (
                <li key={o.id}>
                  {o.orderNumber} · {o.productType}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="border-t border-border pt-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Attach agent to this profile
          </h3>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Paste the public profile link if you have it (easiest). Otherwise use internal DB id, or chain + registry id.
            Unverified agents require <span className="font-medium text-foreground">Force attach</span>.
          </p>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="attach-agent-url" className="text-xs">
              Agent profile URL (optional)
            </Label>
            <Input
              id="attach-agent-url"
              className="h-8 text-xs font-mono"
              placeholder="https://agentranking.io/agents/8453/123/current-agent-name"
              value={attachAgentUrl}
              onChange={(e) => {
                setAttachAgentUrl(e.target.value);
                setAttachError(null);
                setOwnerConflict(null);
              }}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="attach-db-id" className="text-xs">
                Agent DB id (internal)
              </Label>
              <Input
                id="attach-db-id"
                className="h-8 text-xs font-mono"
                placeholder="e.g. 12345 — from verified-agents list"
                value={attachDbId}
                onChange={(e) => {
                  setAttachDbId(e.target.value);
                  setAttachError(null);
                  setOwnerConflict(null);
                }}
              />
            </div>
            <div className="space-y-1 sm:col-span-2 grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="attach-chain-id" className="text-xs">
                  Or chain id
                </Label>
                <Input
                  id="attach-chain-id"
                  className="h-8 text-xs font-mono"
                  placeholder="e.g. 8453"
                  value={attachChainId}
                  onChange={(e) => {
                    setAttachChainId(e.target.value);
                    setAttachError(null);
                    setOwnerConflict(null);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="attach-registry-id" className="text-xs">
                  Registry id (on-chain)
                </Label>
                <Input
                  id="attach-registry-id"
                  className="h-8 text-xs font-mono"
                  placeholder="e.g. 38595"
                  value={attachRegistryId}
                  onChange={(e) => {
                    setAttachRegistryId(e.target.value);
                    setAttachError(null);
                    setOwnerConflict(null);
                  }}
                />
              </div>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="attach-reason" className="text-xs">
                Reason (optional, audit log)
              </Label>
              <Textarea
                id="attach-reason"
                className="text-xs min-h-[52px]"
                placeholder="Support ticket #…"
                value={attachReason}
                onChange={(e) => setAttachReason(e.target.value)}
              />
            </div>
          </div>
          {ownerConflict && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              Current owner: <span className="font-mono">{ownerConflict.previousOwner}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="force-attach"
              checked={forceAttach}
              onCheckedChange={(v: boolean) => setForceAttach(v === true)}
            />
            <Label htmlFor="force-attach" className="text-xs cursor-pointer leading-snug">
              Force attach — take over from another owner if needed, and allow unverified agents (Agent Dashboard access)
            </Label>
          </div>
          {attachError && (
            <p className="text-xs text-destructive whitespace-pre-line break-words">{attachError}</p>
          )}
          <Button size="sm" className="h-8" disabled={attachLoading} onClick={() => void submitAttach()}>
            {attachLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Attach to this user"}
          </Button>
        </section>
      </div>
    );
  } else {
    agentsModalBody = <p className="text-sm text-muted-foreground">{attachError ?? "No data."}</p>;
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Users</h1>
        <span className="text-sm text-muted-foreground">{data?.total ?? 0} profiles</span>
      </div>
      {/* Search */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search wallet, username, name…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex gap-2 max-w-md flex-1 min-w-[240px]">
          <Input
            placeholder="Lookup agents by email…"
            value={emailLookup}
            onChange={(e) => setEmailLookup(e.target.value)}
            className="h-9 text-sm"
            type="email"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-9 shrink-0"
            onClick={() => void openAgentsByEmail(emailLookup)}
          >
            <Bot className="h-3.5 w-3.5 mr-1" /> Agents
          </Button>
        </div>
      </div>
      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Wallet</th>
              <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium hidden md:table-cell">Username</th>
              <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium hidden lg:table-cell">Bio</th>
              <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Agents</th>
              <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Reviews</th>
              <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium hidden md:table-cell">Joined</th>
              <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && (
              <>
                {(["s1", "s2", "s3", "s4", "s5"] as const).map((sk) => (
                  <tr key={sk} className="animate-pulse">
                    <td className="px-4 py-3"><div className="h-3 bg-muted rounded w-28" /></td>
                    <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 bg-muted rounded w-20" /></td>
                    <td className="px-4 py-3 hidden lg:table-cell"><div className="h-3 bg-muted rounded w-40" /></td>
                    <td className="px-4 py-3"><div className="h-3 bg-muted rounded w-8 ml-auto" /></td>
                    <td className="px-4 py-3"><div className="h-3 bg-muted rounded w-8 ml-auto" /></td>
                    <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 bg-muted rounded w-20 ml-auto" /></td>
                    <td className="px-4 py-3"><div className="h-3 bg-muted rounded w-16 ml-auto" /></td>
                  </tr>
                ))}
              </>
            )}
            {!loading && data?.profiles?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No profiles found.
                </td>
              </tr>
            )}
            {!loading && data && data.profiles.length > 0 && data.profiles.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div>
                        <p className="font-mono text-xs">
                          {p.walletAddress ? truncateAddress(p.walletAddress, 8) : "—"}
                        </p>
                        {p.displayName && <p className="text-xs text-muted-foreground">{p.displayName}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      {p.username ? (
                        <span className="text-xs font-medium">@{p.username}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 hidden lg:table-cell">
                      <p className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]">
                        {p.bio || <span className="text-muted-foreground/40">—</span>}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs">{p.agentsCount}</td>
                    <td className="px-4 py-2.5 text-right text-xs">{p.feedbackCount}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground hidden md:table-cell">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-1.5 gap-1 text-xs"
                          title="Agent Dashboard + paid agents"
                          disabled={!p.walletAddress}
                          onClick={() => p.walletAddress && openAgentsModal(p.walletAddress)}
                        >
                          <Bot className="h-3 w-3" />
                          <span className="hidden sm:inline">Agents</span>
                        </Button>
                        {p.walletAddress ? (
                          <Button asChild variant="ghost" size="sm" className="h-6 w-6 p-0" title="View profile">
                            <Link href={`/profiles/${p.walletAddress}`} target="_blank">
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="No wallet" disabled>
                            <ExternalLink className="h-3 w-3 opacity-30" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          title="Clear username/bio"
                          disabled={!p.walletAddress || clearingWallet === p.walletAddress}
                          onClick={() => p.walletAddress && clearProfile(p.walletAddress)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {data.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
      <Dialog
        open={agentsOpen}
        onOpenChange={(open: boolean) => {
          setAgentsOpen(open);
          if (!open) {
            setAgentsWallet(null);
                        setLocalAgentsData(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton>
          <DialogHeader>
            <DialogTitle>
              {agentsWallet ? `Agents for ${truncateAddress(agentsWallet, 8)}` : "Agents by email"}
            </DialogTitle>
            <DialogDescription>
              Owned agents match this profile&apos;s wallet or linked execution wallet. Paid / promos include orders,
              boosts, or listing slots tied to the payer wallet. Attaching sets{" "}
              <code className="text-xs">Agent.owner</code> so the agent appears in{" "}
              <Link href="/dashboard" className="text-primary underline" target="_blank">
                Dashboard
              </Link>{" "}
              (verified agents only).
            </DialogDescription>
          </DialogHeader>
          {agentsModalBody}
        </DialogContent>
      </Dialog>
    </div>
  );
}