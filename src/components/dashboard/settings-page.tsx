"use client";
import { useTransientState } from "@/hooks/use-transient-state";
import { useCallback, useEffect, useState } from "react";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useStoredAgentId } from "@/hooks/use-stored-agent-id";
import { writeStoredAgentId } from "@/lib/dashboard/active-agent";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { buildSignOutCallbackUrl } from "@/lib/app-auth-routes";
import { AlertTriangle, Check, Copy, Eye, EyeOff, Key, Loader2, Rocket, Trash2, Wallet, X } from "lucide-react";
import type { DashboardAgentSummary } from "@/lib/dashboard/types";
import { AgentProfileEditLink } from "@/components/dashboard/agent-profile-edit-link";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { RegisteredTick } from "@/components/shared/registered-badge";
import { VerifiedTick } from "@/components/shared/verified-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast-simple";
import { cn } from "@/lib/utils";
import { shortenSolanaAddress } from "@/lib/custodial-wallet/solscan";
import { shortenEvmAddress } from "@/lib/evm-wallet-utils";
import { SecuritySettingsCard } from "@/components/dashboard/security-settings-card";
import { LlmProviderCredentialsCard } from "@/components/dashboard/llm-provider-credentials-card";
import type {
  DashboardAccountSettingsDto as AccountSettingsData,
  DashboardSecurityStatusDto,
} from "@/lib/dashboard/account-settings.server";
import type { DashboardSubscriptionDto } from "@/lib/dashboard/account-subscription.server";
import { getDashboardAgentIdentityStatus } from "@/lib/dashboard/agent-verification-display";
const SETTINGS_PANEL_BODY = "ui-settings-panel-body space-y-4";
type SettingsTab = "agent" | "account";
type AgentTokenLaunch = {
  chain: "solana" | "robinhood";
  address: string;
  symbol: string | null;
  name: string | null;
  status: string | null;
  network: string | null;
};
type AgentSettingsData = {
  publicKey: string | null;
  solscanUrl: string | null;
  balanceSol: string | null;
  isSolCustodial: boolean;
  evmAddress: string | null;
  isEvmCustodial: boolean;
  launches: AgentTokenLaunch[];
  twitter: string | null;
  telegram: string | null;
  website: string | null;
};
export function DashboardSettingsPage({
  ownedAgents,
  accountIsVerified,
  initialAccountData,
  initialSecurityStatus,
  initialSubscription,
  initialSupportUnread,
}: {
  readonly ownedAgents: DashboardAgentSummary[];
  readonly accountIsVerified: boolean;
  readonly initialAccountData: AccountSettingsData;
  readonly initialSecurityStatus: DashboardSecurityStatusDto;
  readonly initialSubscription: DashboardSubscriptionDto;
  readonly initialSupportUnread: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const storedAgentId = useStoredAgentId(ownedAgents);
  const [selectedAgentOverride, setSelectedAgentOverride] = useState<number | null>(null);
  const selectedAgentId =
    selectedAgentOverride != null && ownedAgents.some((agent) => agent.id === selectedAgentOverride)
      ? selectedAgentOverride
      : storedAgentId ?? ownedAgents[0]?.id ?? null;
  const selectedAgent = ownedAgents.find((agent) => agent.id === selectedAgentId) ?? null;
  const selectAgent = useCallback((agentDbId: number) => {
    setSelectedAgentOverride(agentDbId);
    writeStoredAgentId(agentDbId);
  }, []);
  const requestedTab = searchParams.get("tab");
  const providerError = searchParams.get("error");
  const [activeTabOverride, setActiveTabOverride] = useState<SettingsTab | null>(null);
  const defaultTab: SettingsTab =
    requestedTab === "account" || providerError || ownedAgents.length === 0
      ? "account"
      : "agent";
  const activeTab: SettingsTab = activeTabOverride ?? defaultTab;

  const selectSettingsTab = useCallback(
    (tab: SettingsTab) => {
      setActiveTabOverride(tab);
      const nextUrl =
        tab === "account" ? "/dashboard/settings?tab=account" : "/dashboard/settings";
      router.replace(nextUrl, { scroll: false });
    },
    [router],
  );
  const loadAgentSettings = useCallback(
    async (signal: AbortSignal): Promise<AgentSettingsData | null> => {
      if (selectedAgentId == null) return null;
      const agentDbId = selectedAgentId;
      const [walletInfoRes, launchRes, walletRes, evmActivityRes] = await Promise.all([
        fetch(`/api/dashboard/agents/${agentDbId}/wallet-info`, { signal }),
        fetch(`/api/agent-launch/drafts/by-agent?agentDbId=${agentDbId}&includeUnindexed=1`, { signal }),
        fetch(`/api/dashboard/agents/${agentDbId}/evm-wallet`, { signal }),
        fetch(`/api/dashboard/agents/${agentDbId}/evm-activity`, { signal }),
      ]);
      const walletInfoPayload = (await walletInfoRes.json().catch(() => ({}))) as {
        publicKey?: string;
      };
      const launchPayload = (await launchRes.json().catch(() => null)) as {
        mint?: string | null;
        tokenSymbol?: string | null;
        tokenName?: string | null;
        launchStatus?: string | null;
        network?: string | null;
      } | null;
      const evmPayload = (await walletRes.json().catch(() => ({}))) as {
        configured?: boolean;
        address?: string | null;
        provider?: string | null;
        isCustodial?: boolean;
      };
      const evmActivityPayload = (await evmActivityRes.json().catch(() => ({}))) as {
        activity?: Array<{
          type?: string;
          tokenName?: string | null;
          tokenSymbol?: string | null;
          tokenAddress?: string;
          sourceVerified?: boolean;
        }>;
      };
      const solPublicKey = walletInfoPayload.publicKey ?? null;
      const launches: AgentTokenLaunch[] = [];
      if (launchPayload?.mint) {
        launches.push({
          chain: "solana",
          address: launchPayload.mint,
          symbol: launchPayload.tokenSymbol ?? null,
          name: launchPayload.tokenName ?? null,
          status: launchPayload.launchStatus ?? null,
          network: launchPayload.network ?? "solana",
        });
      }
      for (const row of evmActivityPayload.activity ?? []) {
        if (row.type !== "launch" || !row.tokenAddress) continue;
        launches.push({
          chain: "robinhood",
          address: row.tokenAddress,
          symbol: row.tokenSymbol ?? null,
          name: row.tokenName ?? null,
          status: row.sourceVerified ? "verified" : "launched",
          network: "robinhood-chain",
        });
      }
      return {
        publicKey: solPublicKey,
        solscanUrl: null,
        balanceSol: null,
        isSolCustodial: Boolean(solPublicKey),
        evmAddress: evmPayload.configured && evmPayload.address ? evmPayload.address : null,
        isEvmCustodial: Boolean(evmPayload.isCustodial ?? evmPayload.provider === "custodial"),
        launches,
        twitter: null,
        telegram: null,
        website: null,
      };
    },
    [selectedAgentId],
  );
  const agentResource = useAsyncResource(
    `settings-agent:${selectedAgentId ?? "none"}`,
    loadAgentSettings,
  );
  const loadAccountSettings = useCallback(async (signal: AbortSignal): Promise<AccountSettingsData> => {
    const response = await fetch("/api/dashboard/settings/account-summary", { signal });
    const data = (await response.json().catch(() => ({}))) as AccountSettingsData & { error?: string };
    if (!response.ok || data.error) throw new Error(data.error || "Could not load account settings");
    return data;
  }, []);
  const accountResource = useAsyncResource("settings-account", loadAccountSettings, {
    initialData: initialAccountData,
    initialDataKey: "settings-account",
    revalidateOnMount: false,
  });
  const agentData = agentResource.data;
  const agentLoading = agentResource.loading;
  const accountData = accountResource.data;
  const accountLoading = accountResource.loading;
  // Delete state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Delete account state
  const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false);
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState("");
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  // Utility
  const [walletCopied, setWalletCopied] = useTransientState(false, 1500);
  const [exportKeyTarget, setExportKeyTarget] = useState<"solana" | "evm" | null>(null);
  const [exportKeyValue, setExportKeyValue] = useState<string | null>(null);
  const [exportKeyVisible, setExportKeyVisible] = useState(false);
  const [exportKeyLoading, setExportKeyLoading] = useState(false);
  useEffect(() => {
    if (!providerError) return;
    const messages: Record<string, string> = {
      provider_linked_elsewhere: "That sign-in method belongs to a different account.",
      link_session_expired: "Session expired. Try signing in again.",
      email_required: "Could not finish sign-in — email was missing.",
      missing_provider_account: "Could not finish sign-in — provider account missing.",
    };
    showToast(messages[providerError] ?? "Could not complete sign-in. Try again.", "error");
    router.replace("/dashboard/settings?tab=account", { scroll: false });
  }, [providerError, router]);
  const copyWallet = useCallback(async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setWalletCopied(true);
    } catch {
      // ignore
    }
  }, [setWalletCopied]);
  const resetExportKey = useCallback(() => {
    setExportKeyTarget(null);
    setExportKeyValue(null);
    setExportKeyVisible(false);
    setExportKeyLoading(false);
  }, []);
  const openExportKey = useCallback(
    async (target: "solana" | "evm") => {
      if (!selectedAgentId) return;
      setExportKeyTarget(target);
      setExportKeyValue(null);
      setExportKeyVisible(false);
      setExportKeyLoading(true);
      try {
        const res = await fetch(
          `/api/dashboard/agents/${selectedAgentId}/export-key?chain=${target}`,
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || "Failed to fetch key");
        }
        const json = (await res.json()) as { key: string };
        setExportKeyValue(json.key);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to export key", "error");
        setExportKeyValue(null);
      } finally {
        setExportKeyLoading(false);
      }
    },
    [selectedAgentId],
  );
  const handleDeleteAgent = useCallback(async () => {
    if (deleteConfirm !== "DELETE" || !selectedAgentId) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/dashboard/agents/${selectedAgentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        hasToken?: boolean;
        nextAgentId?: number;
        redirectTo?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to delete agent");
      }
      setDeleteModalOpen(false);
      setDeleteConfirm("");
      if (data.hasToken) {
        showToast("Agent archived. Public token history remains available.", "info");
      } else {
        showToast("Agent deleted", "info");
      }
      if (data.redirectTo) {
        // Hard navigation forces a full layout re-fetch so the sidebar
        // picks up the now-filtered agent list (soft-deleted agents excluded).
        window.location.href = data.redirectTo;
      } else {
        router.refresh();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not delete agent";
      setDeleteError(msg);
      showToast(msg, "error");
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteConfirm, selectedAgentId, router]);
  const handleDeleteAccount = useCallback(async () => {
    if (deleteAccountConfirm !== "DELETE") return;
    setDeleteAccountLoading(true);
    setDeleteAccountError(null);
    try {
      const res = await fetch("/api/dashboard/settings/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to delete account");
      }
      setDeleteAccountModalOpen(false);
      showToast("Account deleted. Redirecting to login…", "info");
      setTimeout(() => {
        signOut({ callbackUrl: buildSignOutCallbackUrl("/auth/login") });
      }, 800);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not delete account";
      setDeleteAccountError(msg);
      showToast(msg, "error");
    } finally {
      setDeleteAccountLoading(false);
    }
  }, [deleteAccountConfirm]);
  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity px-4 py-3.5 sm:px-5">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure your agents, account, and workspace preferences.
          </p>
        </div>
      </div>
      {/* Tab bar */}
      <div
        className="ui-tabs-scroll w-fit max-w-full rounded-full border border-border bg-[#212121] p-1"
        role="tablist"
        aria-label="Settings sections"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "agent"}
          onClick={() => selectSettingsTab("agent")}
          className="inline-flex h-8 shrink-0 items-center justify-center rounded-full px-4 text-sm font-medium"
        >
          Agent
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "account"}
          onClick={() => selectSettingsTab("account")}
          className="inline-flex h-8 shrink-0 items-center justify-center rounded-full px-4 text-sm font-medium"
        >
          Account
        </button>
      </div>
      {activeTab === "agent" && (
        <AgentSettingsTab
          ownedAgents={ownedAgents}
          accountIsVerified={accountIsVerified}
          selectedAgent={selectedAgent}
          onSelectAgent={selectAgent}
          agentData={agentData}
          agentLoading={agentLoading}
          walletCopied={walletCopied}
          onCopyWallet={copyWallet}
          onExportKey={(target) => void openExportKey(target)}
          onDeleteClick={() => setDeleteModalOpen(true)}
        />
      )}
      {activeTab === "account" && (
        <AccountSettingsTab
          accountData={accountData}
          accountLoading={accountLoading}
          walletCopied={walletCopied}
          onCopyWallet={copyWallet}
          onDeleteAccountClick={() => setDeleteAccountModalOpen(true)}
          initialSecurityStatus={initialSecurityStatus}
          initialSubscription={initialSubscription}
          initialSupportUnread={initialSupportUnread}
        />
      )}
      {exportKeyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-background border-border/60 w-full max-w-md rounded-xl border shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">Export private key</h2>
                <p className="text-muted-foreground text-xs">
                  {exportKeyTarget === "solana" ? "Solana wallet" : "EVM wallet"}
                </p>
              </div>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={resetExportKey}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="text-xs font-medium leading-relaxed text-amber-600 dark:text-amber-400">
                  Never share your private key. Anyone with this key can control your wallet and funds.
                </p>
              </div>
              {exportKeyLoading ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
                  <p className="text-sm">Retrieving key…</p>
                </div>
              ) : exportKeyValue ? (
                <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 break-all font-mono text-xs text-foreground/90">
                      {exportKeyVisible
                        ? exportKeyValue
                        : "•".repeat(exportKeyTarget === "evm" ? 66 : 64)}
                    </p>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                      onClick={() => setExportKeyVisible((v) => !v)}
                      aria-label={exportKeyVisible ? "Hide key" : "Show key"}
                    >
                      {exportKeyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                      onClick={() => {
                        void navigator.clipboard.writeText(exportKeyValue);
                        showToast("Key copied to clipboard");
                        setTimeout(() => resetExportKey(), 1500);
                      }}
                      aria-label="Copy key"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-destructive text-sm">Failed to retrieve key. Please try again.</p>
              )}
              <Button size="sm" variant="secondary" className="w-full" onClick={resetExportKey}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Delete agent modal */}
      {deleteModalOpen && selectedAgentId != null && (
        <DeleteAgentModal
          agentName={selectedAgent?.name ?? "this agent"}
          agentDbId={selectedAgentId}
          deleteConfirm={deleteConfirm}
          onDeleteConfirm={setDeleteConfirm}
          deleteLoading={deleteLoading}
          deleteError={deleteError}
          onDelete={handleDeleteAgent}
          onClose={() => {
            setDeleteModalOpen(false);
            setDeleteConfirm("");
            setDeleteError(null);
          }}
        />
      )}
      {/* Delete account modal */}
      {deleteAccountModalOpen && (
        <DeleteAccountModal
          deleteConfirm={deleteAccountConfirm}
          onDeleteConfirm={setDeleteAccountConfirm}
          deleteLoading={deleteAccountLoading}
          deleteError={deleteAccountError}
          onDelete={handleDeleteAccount}
          onClose={() => {
            setDeleteAccountModalOpen(false);
            setDeleteAccountConfirm("");
            setDeleteAccountError(null);
          }}
        />
      )}
    </div>
  );
}
/* ------- Agent Settings Tab ------- */
function AgentSettingsTab({
  ownedAgents,
  accountIsVerified,
  selectedAgent,
  onSelectAgent,
  agentData,
  agentLoading,
  walletCopied,
  onCopyWallet,
  onExportKey,
  onDeleteClick,
}: {
  readonly ownedAgents: DashboardAgentSummary[];
  readonly accountIsVerified: boolean;
  readonly selectedAgent: DashboardAgentSummary | null;
  readonly onSelectAgent: (id: number) => void;
  readonly agentData: AgentSettingsData | null;
  readonly agentLoading: boolean;
  readonly walletCopied: boolean;
  readonly onCopyWallet: (key: string) => void;
  readonly onExportKey: (target: "solana" | "evm") => void;
  readonly onDeleteClick: () => void;
}) {
  if (ownedAgents.length === 0) {
    return (
      <div className="ui-overview-panel overflow-hidden rounded-xl p-0 px-5 py-4">
        <p className="text-muted-foreground text-sm">
          No agents yet. Create an agent to configure it here.
        </p>
      </div>
    );
  }
  if (!selectedAgent) {
    return (
      <div className="ui-overview-panel overflow-hidden rounded-xl p-0 px-5 py-4">
        <p className="text-muted-foreground text-sm">Select an agent to view its settings.</p>
      </div>
    );
  }
  const identityStatus = getDashboardAgentIdentityStatus(selectedAgent, accountIsVerified);
  return (
    <div className="space-y-4">
          {ownedAgents.length > 1 ? (
            <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
              <div className="ui-overview-panel-header px-5 py-4">
                <label htmlFor="settings-agent" className="text-sm font-medium">Agent</label>
              </div>
              <div className={SETTINGS_PANEL_BODY}>
                <select
                  id="settings-agent"
                  value={selectedAgent.id}
                  onChange={(event) => onSelectAgent(Number(event.target.value))}
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                >
                  {ownedAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
            <div className="ui-overview-panel-header flex items-center gap-3 px-5 py-4">
              <AgentAvatar image={selectedAgent.image} name={selectedAgent.name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-sm font-medium">{selectedAgent.name}</p>
                  {identityStatus.isVerified ? <VerifiedTick size="sm" /> : null}
                  {identityStatus.isRegistered ? <RegisteredTick size="sm" /> : null}
                </div>
                <p
                  className={cn(
                    "text-xs",
                    identityStatus.isVerified
                      ? "text-[var(--ui-gold-bright)]"
                      : identityStatus.isPending
                        ? "text-muted-foreground"
                        : identityStatus.isRegistered
                          ? "text-foreground"
                          : "text-muted-foreground",
                  )}
                >
                  {identityStatus.subtitle}
                </p>
              </div>
              <AgentProfileEditLink agentDbId={selectedAgent.id} />
            </div>
          </div>
          {/* Agent wallet card */}
          <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
            <div className="ui-overview-panel-header flex items-center gap-2 px-5 py-4">
              <Wallet className="text-muted-foreground h-4 w-4" aria-hidden />
              <p className="text-sm font-medium">Agent wallets</p>
            </div>
            <div className={SETTINGS_PANEL_BODY}>
            {agentLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading wallet…
              </div>
            ) : (
              <div className="space-y-5">
                {agentData?.publicKey ? (
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Solana</p>
                    <p className="font-mono text-sm break-all leading-relaxed">{agentData.publicKey}</p>
                    {agentData.balanceSol ? (
                      <p className="text-muted-foreground text-xs">
                        {agentData.balanceSol} SOL
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onCopyWallet(agentData.publicKey!)}
                      >
                        {walletCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        Copy
                      </Button>
                      {agentData.isSolCustodial ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onExportKey("solana")}
                        >
                          <Key className="h-3 w-3" />
                          Export key
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">Solana wallet provisioning in progress…</p>
                )}
                {agentData?.evmAddress ? (
                  <div className="space-y-3 border-t border-border/60 pt-5">
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">EVM</p>
                    <p className="font-mono text-sm break-all leading-relaxed">{agentData.evmAddress}</p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onCopyWallet(agentData.evmAddress!)}
                      >
                        <Copy className="h-3 w-3" />
                        Copy
                      </Button>
                      {agentData.isEvmCustodial ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onExportKey("evm")}
                        >
                          <Key className="h-3 w-3" />
                          Export key
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="border-t border-border/60 pt-5">
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      EVM wallet not set up yet. Create a new agent to auto-generate both wallets, or set it up from the Wallet page.
                    </p>
                  </div>
                )}
                <p className="text-muted-foreground border-t border-border/60 pt-4 text-xs leading-relaxed">
                  Used for token launches, creator fees, and agent-owned funds.
                </p>
              </div>
            )}
            </div>
          </div>
          {/* Token status card */}
          <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
            <div className="ui-overview-panel-header flex items-center gap-2 px-5 py-4">
              <Rocket className="text-muted-foreground h-4 w-4" aria-hidden />
              <p className="text-sm font-medium">Token status</p>
            </div>
            <div className={SETTINGS_PANEL_BODY}>
            {agentLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading token status…
              </div>
            ) : agentData?.launches && agentData.launches.length > 0 ? (
              <div className="space-y-5">
                {agentData.launches.map((launch) => {
                  const isRobinhood = launch.chain === "robinhood";
                  const label = launch.symbol ? `$${launch.symbol}` : launch.name || "Token";
                  const shortAddress = isRobinhood
                    ? shortenEvmAddress(launch.address, 6)
                    : shortenSolanaAddress(launch.address, 8);
                  return (
                    <div key={`${launch.chain}-${launch.address}`} className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                          Token launched
                        </p>
                        <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {isRobinhood ? "Robinhood" : "Solana"}
                        </span>
                      </div>
                      <p className="text-sm">{label}</p>
                      <p className="font-mono text-xs text-muted-foreground">{shortAddress}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">No token launched</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Launch a Solana (Pump.fun) or Robinhood Chain token linked to this agent.
                </p>
              </div>
            )}
            </div>
          </div>
          {/* X / Social routing card */}
          <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
            <div className="ui-overview-panel-header px-5 py-4">
              <p className="text-sm font-medium">Social / external links</p>
            </div>
            <div className={cn(SETTINGS_PANEL_BODY, "space-y-3")}>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground shrink-0">X / Twitter</span>
                <span className="text-muted-foreground min-w-0 text-right text-xs">
                  {agentData?.twitter ? agentData.twitter : "Not connected"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Telegram</span>
                <span className="text-muted-foreground min-w-0 text-right text-xs">
                  {agentData?.telegram ? agentData.telegram : "Not connected"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Website</span>
                <span className="text-muted-foreground min-w-0 text-right text-xs">
                  {agentData?.website ? agentData.website : "Coming soon"}
                </span>
              </div>
            </div>
          </div>
          {/* Danger zone */}
          <div className="ui-overview-panel overflow-hidden rounded-xl border-destructive/30 p-0">
            <div className="ui-overview-panel-header flex items-center gap-2 px-5 py-4">
              <Trash2 className="text-destructive h-4 w-4" aria-hidden />
              <p className="text-sm font-medium text-destructive">Danger zone</p>
            </div>
            <div className={cn(SETTINGS_PANEL_BODY, "space-y-3")}>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Permanently remove this agent from your workspace.
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={onDeleteClick}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Delete agent
            </Button>
            </div>
          </div>
    </div>
  );
}
/* ------- Account Settings Tab ------- */
function AccountSettingsTab({
  accountData,
  accountLoading,
  walletCopied,
  onCopyWallet,
  onDeleteAccountClick,
  initialSecurityStatus,
  initialSubscription,
  initialSupportUnread,
}: {
  readonly accountData: AccountSettingsData | null;
  readonly accountLoading: boolean;
  readonly walletCopied: boolean;
  readonly onCopyWallet: (key: string) => void;
  readonly onDeleteAccountClick: () => void;
  readonly initialSecurityStatus: DashboardSecurityStatusDto;
  readonly initialSubscription: DashboardSubscriptionDto;
  readonly initialSupportUnread: number;
}) {
  if (accountLoading && !accountData) {
    return (
      <div className="ui-overview-panel overflow-hidden rounded-xl p-0 px-5 py-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading account…
        </div>
      </div>
    );
  }
  if (!accountData) {
    return (
      <div className="ui-overview-panel overflow-hidden rounded-xl p-0 px-5 py-4">
        <p className="text-muted-foreground text-sm">
          Could not load account data. Please refresh.
        </p>
      </div>
    );
  }
  const googleLinked = Boolean(accountData.linkedProviders?.google);
  const twitterLinked = Boolean(accountData.linkedProviders?.twitter);
  const twitterUsername = accountData.linkedProviders?.twitterUsername;
  return (
    <div className="space-y-4">
      {/* Profile card */}
      <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <p className="text-sm font-medium">Account</p>
        </div>
        <div className={cn(SETTINGS_PANEL_BODY, "space-y-3 text-sm")}>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Name</span>
            <span className="min-w-0 text-right">{accountData.displayName}</span>
          </div>
          {accountData.email ? (
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground shrink-0">Email</span>
              <span className="min-w-0 break-all text-right font-mono text-xs">{accountData.email}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Agents</span>
            <span className="text-right">
              {accountData.agentCount}/{accountData.maxAgents}
            </span>
          </div>
        </div>
      </div>
      {/* Login methods card — status only; no cross-linking (keeps wallets/agents per account) */}
      <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <p className="text-sm font-medium">Login methods</p>
        </div>
        <div className={cn(SETTINGS_PANEL_BODY, "space-y-3 text-sm")}>
          <div className="flex items-center gap-3">
            {googleLinked ? (
              <Check className="text-emerald-500 h-4 w-4 shrink-0" />
            ) : (
              <span className="text-muted-foreground/40 h-4 w-4 text-center shrink-0">-</span>
            )}
            <span className={cn("min-w-0 leading-relaxed", !googleLinked && "text-muted-foreground")}>
              {googleLinked ? "Google" : "Google — not used on this account"}
            </span>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            {twitterLinked ? (
              <Check className="text-emerald-500 h-4 w-4 shrink-0" />
            ) : (
              <span className="text-muted-foreground/40 h-4 w-4 text-center shrink-0">-</span>
            )}
            <span className={cn("min-w-0 truncate leading-relaxed", !twitterLinked && "text-muted-foreground")}>
              {twitterLinked
                ? twitterUsername
                  ? `X (@${twitterUsername})`
                  : "X"
                : "X — not used on this account"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground/40 h-4 w-4 text-center shrink-0">-</span>
            <span className="text-muted-foreground leading-relaxed">Telegram — coming soon</span>
          </div>
          <p className="text-muted-foreground border-t border-border/60 pt-4 text-xs leading-relaxed">
            Google and X each create their own account. Sign in with the same method you used before to keep your agents and wallets.
          </p>
        </div>
      </div>
      <div id="security" className="scroll-mt-6">
        <SecuritySettingsCard initialStatus={initialSecurityStatus} />
      </div>
      <LlmProviderCredentialsCard />
      <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <p className="text-sm font-medium">Access & support</p>
        </div>
        <div className={cn(SETTINGS_PANEL_BODY, "space-y-3 text-sm")}>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Workspace access</span>
            <span className="min-w-0 text-right">
              {initialSubscription.displayPlanLabel ??
                (initialSubscription.dashboardUnlocked ? "Unlocked" : "Standard")}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Unread support replies</span>
            <span>{initialSupportUnread}</span>
          </div>
        </div>
      </div>
      {/* LLM wallet card */}
      <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header flex items-center gap-2 px-5 py-4">
          <Wallet className="text-muted-foreground h-4 w-4" aria-hidden />
          <p className="text-sm font-medium">LLM wallet</p>
        </div>
        <div className={SETTINGS_PANEL_BODY}>
        {accountData.accountWalletPublicKey ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">Generated by AgentRanking</p>
            <p className="font-mono text-sm break-all leading-relaxed">
              {accountData.accountWalletPublicKey}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (accountData.accountWalletPublicKey) {
                    onCopyWallet(accountData.accountWalletPublicKey);
                  }
                }}
              >
                {walletCopied ? (
                  <Check className="mr-1 h-3 w-3" />
                ) : (
                  <Copy className="mr-1 h-3 w-3" />
                )}
                Copy
              </Button>
            </div>
            <p className="text-muted-foreground border-t border-border/60 pt-4 text-xs leading-relaxed">
              Used for account-level funding and credits.
            </p>
          </div>
        ) : accountData.walletProvisionError ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {accountData.walletProvisionError}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm leading-relaxed">
            LLM wallet provisioning in progress…
          </p>
        )}
        </div>
      </div>
      {/* Credits card */}
      <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <p className="text-sm font-medium">Credits</p>
        </div>
        <div className={cn(SETTINGS_PANEL_BODY, "space-y-3 text-sm")}>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Platform balance</span>
            <span>{accountData.platformCredits}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground shrink-0">LLM balance</span>
            <span>${(accountData.llmBalanceCents / 100).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 font-medium">
            <span>Total</span>
            <span>${(accountData.totalCredits / 100).toFixed(2)}</span>
          </div>
        </div>
      </div>
      {/* External wallets — secondary */}
      <div className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <p className="text-sm font-medium">External wallets</p>
        </div>
        <div className={cn(SETTINGS_PANEL_BODY, "space-y-3")}>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Optional wallet links for verification and ownership proofs. Not required for
          AgentRanking-native agents.
        </p>
        <p className="text-muted-foreground text-xs italic">Coming soon</p>
        </div>
      </div>
      {/* Danger zone */}
      <div className="ui-overview-panel overflow-hidden rounded-xl border-destructive/30 p-0">
        <div className="ui-overview-panel-header flex items-center gap-2 px-5 py-4">
          <AlertTriangle className="text-destructive h-4 w-4" aria-hidden />
          <p className="text-sm font-medium text-destructive">Danger zone</p>
        </div>
        <div className={cn(SETTINGS_PANEL_BODY, "space-y-3")}>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Permanently delete your account. You will lose access to wallets, tokens, agents,
          credits, and all associated data. This action cannot be undone.
        </p>
        <Button
          variant="destructive"
          size="sm"
          onClick={onDeleteAccountClick}
        >
          <Trash2 className="mr-1 h-3 w-3" />
          Delete my account
        </Button>
        </div>
      </div>
    </div>
  );
}
/* ------- Delete Agent Modal ------- */
function DeleteAgentModal({
  agentName,
  agentDbId: _agentDbId,
  deleteConfirm,
  onDeleteConfirm,
  deleteLoading,
  deleteError,
  onDelete,
  onClose,
}: {
  readonly agentName: string;
  readonly agentDbId: number;
  readonly deleteConfirm: string;
  readonly onDeleteConfirm: (value: string) => void;
  readonly deleteLoading: boolean;
  readonly deleteError: string | null;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background w-full max-w-md rounded-lg border border-border p-6 shadow-xl">
        <h2 className="text-lg font-semibold">Delete agent</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          This will remove <span className="font-medium text-foreground">{agentName}</span> from your
          workspace. Public token and launch history may remain visible for transparency.
        </p>
        <div className="mt-4 space-y-2">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Type DELETE to confirm
          </p>
          <Input
            value={deleteConfirm}
            onChange={(e) => {
              onDeleteConfirm(e.target.value);
            }}
            placeholder="DELETE"
            className="font-mono"
          />
        </div>
        {deleteError ? (
          <p className="text-destructive mt-2 text-sm">{deleteError}</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={deleteLoading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={deleteConfirm !== "DELETE" || deleteLoading}
          >
            {deleteLoading ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete agent"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
/* ------- Delete Account Modal ------- */
function DeleteAccountModal({
  deleteConfirm,
  onDeleteConfirm,
  deleteLoading,
  deleteError,
  onDelete,
  onClose,
}: {
  readonly deleteConfirm: string;
  readonly onDeleteConfirm: (value: string) => void;
  readonly deleteLoading: boolean;
  readonly deleteError: string | null;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background w-full max-w-md rounded-lg border border-border p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-destructive">Delete account</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          This will permanently delete your account and all associated data. You will lose access to
          wallets, tokens, agents, credits, and launch history.
        </p>
        <div className="mt-4 space-y-2">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Type DELETE to confirm
          </p>
          <Input
            value={deleteConfirm}
            onChange={(e) => {
              onDeleteConfirm(e.target.value);
            }}
            placeholder="DELETE"
            className="font-mono"
          />
        </div>
        {deleteError ? (
          <p className="text-destructive mt-2 text-sm">{deleteError}</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={deleteLoading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={deleteConfirm !== "DELETE" || deleteLoading}
          >
            {deleteLoading ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Deleting…
              </>
            ) : (
              "Delete my account"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
