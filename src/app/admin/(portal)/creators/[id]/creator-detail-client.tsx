"use client";
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys } from "@/lib/query-keys/admin";
import { useSourceDraft } from "@/hooks/use-source-draft";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowLeft,
  Bot,
  Coins,
  ExternalLink,
  Loader2,
  Plus,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdminTable, Field } from "@/app/admin/(portal)/ar-token/admin-ui";
import { AdminAgentImageField } from "@/app/admin/(portal)/admin-agent-image-field";
import { showToast } from "@/components/ui/toast-simple";
import { resolveImageUrl } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import {
  ADMIN_TOKEN_VERIFICATION_OPTIONS,
  isArTokenVerified,
  toAdminTokenVerificationChoice,
  type AdminTokenVerificationChoice,
} from "@/lib/agent-launch/token-verification";
import { VerifiedTick } from "@/components/shared/verified-badge";
import type { AdminCreatorDetailDto as CreatorDetail } from "@/lib/admin/identity/types";
type TabId = "account" | "agents" | "tokens";
export function AdminCreatorDetailClient({
  accountId,
  initialData,
}: {
  readonly accountId: string;
  readonly initialData: CreatorDetail;
}) {
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabId>("account");
  const [editingAgentId, setEditingAgentId] = useState<number | null>(null);
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentImage, setAgentImage] = useState("");
  const [agentActive, setAgentActive] = useState(true);
  const [agentVerification, setAgentVerification] = useState("unverified");
  const [editingLaunchId, setEditingLaunchId] = useState<string | null>(null);
  const [launchTokenName, setLaunchTokenName] = useState("");
  const [launchTokenSymbol, setLaunchTokenSymbol] = useState("");
  const [launchTokenImageUrl, setLaunchTokenImageUrl] = useState("");
  const [launchStatus, setLaunchStatus] = useState("");
  const [launchTokenVerification, setLaunchTokenVerification] =
    useState<AdminTokenVerificationChoice>("unverified");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentDescription, setNewAgentDescription] = useState("");
  const [newAgentImage, setNewAgentImage] = useState("");
  const [addingToken, setAddingToken] = useState(false);
  const [newTokenMint, setNewTokenMint] = useState("");
  const [newTokenAgentDbId, setNewTokenAgentDbId] = useState("");
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenSymbol, setNewTokenSymbol] = useState("");
  const [newTokenImageUrl, setNewTokenImageUrl] = useState("");
  const loadCreator = useCallback(async (signal: AbortSignal): Promise<CreatorDetail> => {
    const response = await fetch(`/api/admin/creators/${accountId}`, {
      credentials: "include",
      signal,
    });
    if (!response.ok) throw new Error("Failed to load creator");
    const json = (await response.json()) as { creator: CreatorDetail };
    return json.creator;
  }, [accountId]);
  const queryClient = useQueryClient();
  const creatorQuery = useQuery({
    queryKey: adminKeys.creator(String(accountId)),
    queryFn: ({ signal }) => loadCreator(signal),
    initialData,
    refetchOnMount: false,
  });
  const creator = creatorQuery.data;
  const loading = creatorQuery.isPending;
  const error = creatorQuery.error?.message ?? "";
  const setCreatorData = (updater: CreatorDetail | ((current: CreatorDetail | undefined) => CreatorDetail | undefined)) =>
    queryClient.setQueryData<CreatorDetail | undefined>(adminKeys.creator(String(accountId)), (current) =>
      typeof updater === "function"
        ? (updater as (c: CreatorDetail | undefined) => CreatorDetail | undefined)(current)
        : updater,
    );
  const refreshCreator = () => void creatorQuery.refetch();
  const creatorSourceKey = creator
    ? [creator.id, creator.displayName ?? "", creator.email ?? "", creator.adminNotes, creator.maxAgents, creator.platformCredits, creator.llmCredits].join(":")
    : `loading:${accountId}`;
  const [displayName, setDisplayName] = useSourceDraft(creatorSourceKey, creator?.displayName ?? "");
  const [email, setEmail] = useSourceDraft(creatorSourceKey, creator?.email ?? "");
  const [adminNotes, setAdminNotes] = useSourceDraft(creatorSourceKey, creator?.adminNotes ?? "");
  const [maxAgents, setMaxAgents] = useSourceDraft(creatorSourceKey, String(creator?.maxAgents ?? 3));
  const [platformCredits, setPlatformCredits] = useSourceDraft(creatorSourceKey, String(creator?.platformCredits ?? 0));
  const [llmCredits, setLlmCredits] = useSourceDraft(creatorSourceKey, String(creator?.llmCredits ?? 0));
  async function saveAccount() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/creators/${accountId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          email,
          adminNotes,
          maxAgents: Number(maxAgents),
          platformCredits: Number(platformCredits),
          llmCredits: Number(llmCredits),
        }),
      });
      const json = (await res.json()) as { creator?: CreatorDetail; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      if (json.creator) setCreatorData(json.creator);
      showToast("Account updated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }
  function startEditAgent(agent: CreatorDetail["agents"][number]) {
    setCreatingAgent(false);
    setEditingAgentId(agent.id);
    setAgentName(agent.name);
    setAgentDescription(agent.description);
    setAgentImage(agent.image);
    setAgentActive(agent.isActive);
    setAgentVerification(agent.publicVerificationStatus);
  }
  function startCreateAgent() {
    setEditingAgentId(null);
    setCreatingAgent(true);
    setNewAgentName("");
    setNewAgentDescription("");
    setNewAgentImage("");
  }
  async function createAgent() {
    if (!newAgentName.trim()) {
      showToast("Agent name is required", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/creators/${accountId}/agents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newAgentName,
          description: newAgentDescription,
          image: newAgentImage,
        }),
      });
      const json = (await res.json()) as { creator?: CreatorDetail; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Create failed");
      if (json.creator) setCreatorData(json.creator);
      setCreatingAgent(false);
      showToast("Agent created", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Create failed", "error");
    } finally {
      setSaving(false);
    }
  }
  async function saveAgent() {
    if (editingAgentId == null) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/verified-agents/${editingAgentId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agentName,
          description: agentDescription,
          image: agentImage,
          isActive: agentActive,
          publicVerificationStatus: agentVerification,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Agent update failed");
      setEditingAgentId(null);
      refreshCreator();
      showToast("Agent updated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Agent update failed", "error");
    } finally {
      setSaving(false);
    }
  }
  function startEditLaunch(launch: CreatorDetail["launches"][number]) {
    setAddingToken(false);
    setEditingLaunchId(launch.id);
    setLaunchTokenName(launch.tokenName ?? "");
    setLaunchTokenSymbol(launch.tokenSymbol ?? "");
    setLaunchTokenImageUrl(launch.tokenImageUrl ?? "");
    setLaunchStatus(launch.launchStatus);
    setLaunchTokenVerification(toAdminTokenVerificationChoice(launch.arTokenVerificationStatus));
  }
  function startAddToken() {
    setEditingLaunchId(null);
    setAddingToken(true);
    setNewTokenMint("");
    setNewTokenAgentDbId(creator?.agents[0]?.id ? String(creator.agents[0].id) : "");
    setNewTokenName("");
    setNewTokenSymbol("");
    setNewTokenImageUrl("");
  }
  async function addToken() {
    if (!newTokenMint.trim()) {
      showToast("Mint address is required", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/creators/${accountId}/launches`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint: newTokenMint.trim(),
          agentDbId: newTokenAgentDbId ? Number(newTokenAgentDbId) : null,
          tokenName: newTokenName,
          tokenSymbol: newTokenSymbol,
          tokenImageUrl: newTokenImageUrl,
        }),
      });
      const json = (await res.json()) as { creator?: CreatorDetail; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Add token failed");
      if (json.creator) setCreatorData(json.creator);
      setAddingToken(false);
      showToast("Token linked", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Add token failed", "error");
    } finally {
      setSaving(false);
    }
  }
  async function saveLaunch() {
    if (!editingLaunchId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/launches/${editingLaunchId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenName: launchTokenName,
          tokenSymbol: launchTokenSymbol,
          tokenImageUrl: launchTokenImageUrl,
          launchStatus,
          arTokenVerificationStatus: launchTokenVerification,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Launch update failed");
      setEditingLaunchId(null);
      refreshCreator();
      showToast("Launch updated", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Launch update failed", "error");
    } finally {
      setSaving(false);
    }
  }
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading creator…
      </div>
    );
  }
  if (!creator) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/creators">
            <ArrowLeft className="mr-1.5 size-4" />
            Creators
          </Link>
        </Button>
        <p className="text-destructive">{error || "Creator not found"}</p>
      </div>
    );
  }
  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "account", label: "Account" },
    { id: "agents", label: "Agents", count: creator.agentCount },
    { id: "tokens", label: "Tokens", count: creator.launches.length },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
            <Link href="/admin/creators">
              <ArrowLeft className="mr-1.5 size-4" />
              Creators
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {creator.displayName ?? creator.email ?? "Creator"}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {creator.email ? <span>{creator.email}</span> : null}
            {creator.authProviders.map((p) => (
              <span
                key={p}
                className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase"
              >
                {p}
              </span>
            ))}
            <span>· Joined {format(new Date(creator.createdAt), "MMM d, yyyy")}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count != null ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>
      {tab === "account" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-border p-4">
            <h2 className="font-semibold">Profile</h2>
            <Field label="Display name" value={displayName} onChange={setDisplayName} />
            <Field label="Email" value={email} onChange={setEmail} />
            <div className="space-y-1.5">
              <Label>Admin notes</Label>
              <Textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <div className="space-y-4 rounded-xl border border-border p-4">
            <h2 className="font-semibold">App account</h2>
            <div className="space-y-1.5">
              <Label>Account wallet</Label>
              <p className="font-mono text-xs break-all text-muted-foreground">
                {creator.accountWalletPublicKey ?? "Not provisioned"}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Max agents" value={maxAgents} onChange={setMaxAgents} />
              <Field label="Platform credits" value={platformCredits} onChange={setPlatformCredits} />
              <Field label="LLM credits" value={llmCredits} onChange={setLlmCredits} />
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Last login: {creator.lastLoginAt ? format(new Date(creator.lastLoginAt), "PPpp") : "—"}</p>
              <p>
                Onboarding:{" "}
                {creator.onboardingCompletedAt
                  ? format(new Date(creator.onboardingCompletedAt), "PPpp")
                  : "Incomplete"}
              </p>
            </div>
            <Button type="button" onClick={() => void saveAccount()} disabled={saving}>
              <Save className="mr-1.5 size-4" />
              {saving ? "Saving…" : "Save account"}
            </Button>
          </div>
        </div>
      ) : null}
      {tab === "agents" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Native agents owned by this creator account.
            </p>
            <Button type="button" size="sm" onClick={startCreateAgent}>
              <Plus className="mr-1.5 size-4" />
              Add agent
            </Button>
          </div>
          {creatingAgent ? (
            <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Bot className="size-4" />
                New agent
              </h3>
              <Field label="Name" value={newAgentName} onChange={setNewAgentName} />
              <AdminAgentImageField
                inputId="new-creator-agent-image"
                value={newAgentImage}
                onChange={setNewAgentImage}
              />
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={newAgentDescription}
                  onChange={(e) => setNewAgentDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={() => void createAgent()} disabled={saving}>
                  Create agent
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCreatingAgent(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          <AdminTable headers={["", "Agent", "Status", "Token", "Created", ""]}>
            {creator.agents.map((agent) => {
              const thumb = resolveImageUrl(agent.image);
              return (
              <tr key={agent.id} className="border-b border-border/60">
                <td className="px-3 py-3 w-12">
                  <div className="flex size-9 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="size-full object-cover" />
                    ) : (
                      <Bot className="size-4 text-muted-foreground" />
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <p className="font-medium">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">
                    #{agent.agentId} · chain {agent.chainId}
                  </p>
                </td>
                <td className="px-3 py-3 text-xs">
                  <span className={agent.isActive ? "text-green-400" : "text-muted-foreground"}>
                    {agent.isActive ? "Active" : "Inactive"}
                  </span>
                  <span className="block text-muted-foreground">{agent.publicVerificationStatus}</span>
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground">
                  {agent.hasToken ? (
                    <span>
                      {agent.tokenSymbol ?? "Token"}
                      {agent.tokenMint ? (
                        <span className="block font-mono">{agent.tokenMint.slice(0, 8)}…</span>
                      ) : null}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(agent.createdAt), "MMM d, yyyy")}
                </td>
                <td className="px-3 py-3 text-right space-x-2">
                  <Button asChild variant="outline" size="sm">
                    <a href={agent.publicHref} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => startEditAgent(agent)}>
                    Edit
                  </Button>
                </td>
              </tr>
              );
            })}
          </AdminTable>
          {editingAgentId != null ? (
            <div className="rounded-xl border border-border p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Bot className="size-4" />
                Edit agent
              </h3>
              <Field label="Name" value={agentName} onChange={setAgentName} />
              <AdminAgentImageField
                inputId="creator-agent-image"
                value={agentImage}
                onChange={setAgentImage}
              />
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={agentDescription} onChange={(e) => setAgentDescription(e.target.value)} rows={3} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Verification status</Label>
                  <Input value={agentVerification} onChange={(e) => setAgentVerification(e.target.value)} />
                </div>
                <div className="flex items-end gap-2 pb-0.5">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={agentActive}
                      onChange={(e) => setAgentActive(e.target.checked)}
                    />
                    Active
                  </label>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={() => void saveAgent()} disabled={saving}>
                  Save agent
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditingAgentId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {tab === "tokens" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Token launches linked to this creator&apos;s agents.
            </p>
            <Button type="button" size="sm" onClick={startAddToken}>
              <Plus className="mr-1.5 size-4" />
              Add token
            </Button>
          </div>
          {addingToken ? (
            <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Coins className="size-4" />
                Link token by mint
              </h3>
              <Field
                label="Mint address"
                value={newTokenMint}
                onChange={setNewTokenMint}
                placeholder="Solana mint pubkey"
              />
              <div className="space-y-1.5">
                <Label>Linked agent</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={newTokenAgentDbId}
                  onChange={(e) => setNewTokenAgentDbId(e.target.value)}
                >
                  <option value="">No agent link</option>
                  {creator.agents.map((agent) => (
                    <option key={agent.id} value={String(agent.id)}>
                      {agent.name} (#{agent.agentId})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Token name" value={newTokenName} onChange={setNewTokenName} />
                <Field label="Symbol" value={newTokenSymbol} onChange={setNewTokenSymbol} />
              </div>
              <AdminAgentImageField
                label="Token image"
                inputId="new-token-image"
                uploadPrefix="token-images"
                value={newTokenImageUrl}
                onChange={setNewTokenImageUrl}
              />
              <div className="flex gap-2">
                <Button type="button" onClick={() => void addToken()} disabled={saving}>
                  Add token
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAddingToken(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          <AdminTable headers={["", "Token", "Agent", "Network", "Listing", "Created", ""]}>
            {creator.launches.map((launch) => {
              const tokenThumb = resolveImageUrl(launch.tokenImageUrl);
              return (
              <tr key={launch.id} className="border-b border-border/60">
                <td className="px-3 py-3 w-12">
                  <div className="flex size-9 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30">
                    {tokenThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={tokenThumb} alt="" className="size-full object-cover" />
                    ) : (
                      <Coins className="size-4 text-muted-foreground" />
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium">{launch.tokenName ?? launch.tokenSymbol ?? "Unnamed"}</p>
                    {isArTokenVerified(launch.arTokenVerificationStatus) ? (
                      <VerifiedTick size="sm" />
                    ) : null}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">
                    {launch.mint ?? "No mint"}
                  </p>
                </td>
                <td className="px-3 py-3 text-sm text-muted-foreground">{launch.agentName ?? "—"}</td>
                <td className="px-3 py-3 text-xs text-muted-foreground">{launch.network}</td>
                <td className="px-3 py-3 text-xs text-muted-foreground">
                  <span className="block">{launch.launchStatus}</span>
                  {isArTokenVerified(launch.arTokenVerificationStatus) ? (
                    <span className="text-amber-400/90">Verified</span>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(launch.createdAt), "MMM d, yyyy")}
                </td>
                <td className="px-3 py-3 text-right space-x-2">
                  {launch.publicTokenHref ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={launch.publicTokenHref} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" onClick={() => startEditLaunch(launch)}>
                    Edit
                  </Button>
                </td>
              </tr>
              );
            })}
          </AdminTable>
          {creator.launches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No token launches yet.</p>
          ) : null}
          {editingLaunchId ? (
            <div className="rounded-xl border border-border p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Coins className="size-4" />
                Edit launch
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Token name" value={launchTokenName} onChange={setLaunchTokenName} />
                <Field label="Symbol" value={launchTokenSymbol} onChange={setLaunchTokenSymbol} />
              </div>
              <AdminAgentImageField
                label="Token image"
                inputId="edit-token-image"
                uploadPrefix="token-images"
                value={launchTokenImageUrl}
                onChange={setLaunchTokenImageUrl}
              />
              <div className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-3">
                <p className="text-sm font-medium">Token &amp; listing status</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Launch status" value={launchStatus} onChange={setLaunchStatus} />
                  <div className="space-y-1.5">
                    <Label>Token verification</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={launchTokenVerification}
                      onChange={(e) =>
                        setLaunchTokenVerification(e.target.value as AdminTokenVerificationChoice)
                      }
                    >
                      {ADMIN_TOKEN_VERIFICATION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted-foreground">
                      Verified shows a gold check on public token pages; unverified shows nothing.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={() => void saveLaunch()} disabled={saving}>
                  Save launch
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditingLaunchId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}