"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AgentMcpConnectionCreator,
  type AgentMcpConnectionCreatorRequest,
} from "@/components/dashboard/agent-mcp-connection-creator";
import { McpProviderIcon, ReviewedMcpProviders } from "@/components/dashboard/mcp-reviewed-providers";
import { showToast } from "@/components/ui/toast-simple";
import type {
  DashboardAgentMcpItem,
  DashboardMcpApprovalMode,
  DashboardMcpBinding,
  DashboardMcpConnection,
  DashboardMcpProvider,
  DashboardMcpRisk,
  DashboardMcpTool,
} from "@/features/agent-chat/shared/mcp-dashboard-types";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import { cn } from "@/lib/utils";

type Props = {
  agentDbId: number;
  agentName: string;
  initialItems: DashboardAgentMcpItem[];
  initialProviders: DashboardMcpProvider[];
  initialCustomConnectionsAllowed: boolean;
  initialUrlState: {
    oauthResult: "connected" | "error" | "auth-session-required" | null;
    oauthCode: string | null;
    oauthConnectionId: string | null;
  };
};

const fieldClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring";
const HARD_BLOCK = new Set<DashboardMcpRisk>(["SIGN", "BROADCAST", "PAYMENT", "CUSTODY"]);
const RISK_ORDER: DashboardMcpRisk[] = [
  "UNKNOWN",
  "CUSTODY",
  "PAYMENT",
  "BROADCAST",
  "SIGN",
  "TRADE",
  "INFRA_ADMIN",
  "WRITE_OFFCHAIN",
  "TRANSACTION_PREPARE",
  "ANALYTICS_QUERY",
  "READ_ONLY",
];

function apiMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

function readable(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: Date | string | null): string {
  if (!value) return "Never";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "READY") return "default";
  if (["DEGRADED", "AUTH_PENDING", "REAUTH_REQUIRED"].includes(status)) return "secondary";
  if (["INVALID", "BLOCKED"].includes(status)) return "destructive";
  return "outline";
}

function riskVariant(risk: DashboardMcpRisk): "secondary" | "destructive" | "outline" {
  if (HARD_BLOCK.has(risk)) return "destructive";
  if (["UNKNOWN", "TRADE", "INFRA_ADMIN", "WRITE_OFFCHAIN", "TRANSACTION_PREPARE"].includes(risk)) return "secondary";
  return "outline";
}

function optimisticBinding(item: DashboardAgentMcpItem, enabled: boolean): DashboardMcpBinding {
  return item.binding
    ? { ...item.binding, enabled }
    : {
        id: `optimistic:${item.connection.id}`,
        enabled,
        approvalMode: item.connection.provider?.defaultBindingPolicy.approvalMode ?? "CONFIRM_EVERY_CALL",
        maxCallsPerRun: item.connection.provider?.defaultBindingPolicy.maxCallsPerRun ?? 12,
        maxParallelCalls: item.connection.provider?.defaultBindingPolicy.maxParallelCalls ?? 2,
        callTimeoutMs: 30_000,
        outputByteLimit: 1_048_576,
        version: 1,
        overriddenToolCount: 0,
      };
}

export function AgentMcpConnectionsPage({
  agentDbId,
  agentName,
  initialItems,
  initialProviders,
  initialCustomConnectionsAllowed,
  initialUrlState,
}: Props) {
  const queryClient = useQueryClient();
  const bindingsKey = dashboardKeys.agentMcpBindings(agentDbId);
  const bindingsQuery = useQuery({
    queryKey: bindingsKey,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/dashboard/agents/${agentDbId}/mcp-bindings`, {
        cache: "no-store",
        signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not load MCP connections"));
      return (body.items ?? []) as DashboardAgentMcpItem[];
    },
    initialData: initialItems,
    refetchOnMount: false,
  });

  const providersQuery = useQuery({
    queryKey: dashboardKeys.mcpProviders(),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/dashboard/mcp/providers", { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not load MCP providers"));
      return {
        providers: (body.providers ?? []) as DashboardMcpProvider[],
        customAllowed: body.customAllowed === true,
      };
    },
    initialData: {
      providers: initialProviders,
      customAllowed: initialCustomConnectionsAllowed,
    },
    refetchOnMount: false,
  });
  const initialOAuthConnection = initialUrlState.oauthResult === "connected"
    && initialUrlState.oauthConnectionId
    ? initialItems.find((item) => item.connection.id === initialUrlState.oauthConnectionId)?.connection ?? null
    : null;

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "ENABLED" | "AVAILABLE" | "BLOCKED">("ALL");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [chainFilter, setChainFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [riskFilter, setRiskFilter] = useState("ALL");
  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [configureItem, setConfigureItem] = useState<DashboardAgentMcpItem | null>(null);
  const [removeItem, setRemoveItem] = useState<DashboardAgentMcpItem | null>(null);
  const [approvalMode, setApprovalMode] = useState<DashboardMcpApprovalMode>("CONFIRM_EVERY_CALL");
  const [maxCalls, setMaxCalls] = useState(12);
  const [maxParallel, setMaxParallel] = useState(2);
  const [timeoutMs, setTimeoutMs] = useState(30_000);
  const [outputBytes, setOutputBytes] = useState(1_048_576);
  const [toolSearch, setToolSearch] = useState("");
  const [toolBusyId, setToolBusyId] = useState<string | null>(null);
  const [reviewTool, setReviewTool] = useState<DashboardMcpTool | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  const [creatorRequest, setCreatorRequest] = useState<AgentMcpConnectionCreatorRequest | null>(
    initialOAuthConnection
      ? { id: `oauth:${initialOAuthConnection.id}`, kind: "resume", connection: initialOAuthConnection }
      : null,
  );

  useEffect(() => {
    if (!initialUrlState.oauthResult) return;
    if (initialUrlState.oauthResult === "connected") {
      showToast("OAuth connection authorized", "success");
      void queryClient.invalidateQueries({ queryKey: bindingsKey });
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.mcpConnections() });
    } else if (initialUrlState.oauthResult === "auth-session-required") {
      showToast("Sign in again to finish OAuth authorization", "error");
    } else {
      showToast(
        initialUrlState.oauthCode
          ? `OAuth authorization failed (${initialUrlState.oauthCode})`
          : "OAuth authorization failed",
        "error",
      );
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("mcp");
    url.searchParams.delete("code");
    url.searchParams.delete("connectionId");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [bindingsKey, initialUrlState.oauthCode, initialUrlState.oauthResult, queryClient]);

  const toolsKey = configureItem
    ? dashboardKeys.agentMcpTools(agentDbId, configureItem.connection.id)
    : dashboardKeys.agentMcpTools(agentDbId, "none");
  const toolsQuery = useQuery({
    queryKey: toolsKey,
    queryFn: async ({ signal }) => {
      if (!configureItem) return { binding: null, tools: [] as DashboardMcpTool[] };
      const response = await fetch(
        `/api/dashboard/agents/${agentDbId}/mcp-bindings/${encodeURIComponent(configureItem.connection.id)}/tools`,
        { cache: "no-store", signal },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not load tool policies"));
      return body as { binding: DashboardMcpBinding; tools: DashboardMcpTool[] };
    },
    enabled: Boolean(configureItem?.binding),
  });

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return bindingsQuery.data.filter((item) => {
      const enabled = item.binding?.enabled === true;
      if (filter === "ENABLED" && !enabled) return false;
      if (filter === "AVAILABLE" && (enabled || !item.canEnable)) return false;
      if (filter === "BLOCKED" && item.canEnable) return false;
      if (providerFilter !== "ALL" && (item.connection.providerKey ?? "custom") !== providerFilter) return false;
      if (categoryFilter !== "ALL" && !item.connection.provider?.categories.includes(categoryFilter)) return false;
      if (chainFilter !== "ALL" && !item.connection.provider?.chainFamilies.includes(chainFilter)) return false;
      if (statusFilter !== "ALL" && item.connection.status !== statusFilter) return false;
      if (riskFilter !== "ALL" && item.highestEnabledRisk !== riskFilter) return false;
      return !needle || [
        item.connection.displayName,
        item.connection.endpointHost,
        item.connection.provider?.publisherName ?? "custom",
      ].join(" ").toLowerCase().includes(needle);
    });
  }, [bindingsQuery.data, categoryFilter, chainFilter, filter, providerFilter, riskFilter, search, statusFilter]);

  const filterOptions = useMemo(() => ({
    providers: [...new Set(bindingsQuery.data.map((item) => item.connection.providerKey ?? "custom"))].sort(),
    categories: [...new Set(bindingsQuery.data.flatMap((item) => item.connection.provider?.categories ?? []))].sort(),
    chains: [...new Set(bindingsQuery.data.flatMap((item) => item.connection.provider?.chainFamilies ?? []))].sort(),
    statuses: [...new Set(bindingsQuery.data.map((item) => item.connection.status))].sort(),
    risks: [...new Set(bindingsQuery.data.flatMap((item) => item.highestEnabledRisk ? [item.highestEnabledRisk] : []))],
  }), [bindingsQuery.data]);

  const enabledCount = bindingsQuery.data.filter((item) => item.binding?.enabled).length;
  const availableCount = bindingsQuery.data.filter((item) => item.canEnable).length;

  const groupedTools = useMemo(() => {
    const needle = toolSearch.trim().toLowerCase();
    const tools = (toolsQuery.data?.tools ?? []).filter((tool) => !needle || [
      tool.name,
      tool.title ?? "",
      tool.description ?? "",
    ].join(" ").toLowerCase().includes(needle));
    return RISK_ORDER.map((risk) => ({ risk, tools: tools.filter((tool) => tool.effectiveRisk === risk) }))
      .filter((group) => group.tools.length > 0);
  }, [toolSearch, toolsQuery.data]);

  async function putBinding(item: DashboardAgentMcpItem, patch: Record<string, unknown>) {
    const response = await fetch(
      `/api/dashboard/agents/${agentDbId}/mcp-bindings/${encodeURIComponent(item.connection.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(apiMessage(body, "Could not update connection assignment"));
    return body.item as DashboardAgentMcpItem;
  }

  function updateAccountAttachment(item: DashboardAgentMcpItem) {
    queryClient.setQueryData<DashboardMcpConnection[]>(
      dashboardKeys.mcpConnections(),
      (current) => current?.map((connection) => connection.id === item.connection.id
        ? {
            ...connection,
            attachedAgents: [
              ...connection.attachedAgents.filter((agent) => agent.id !== agentDbId),
              ...(item.binding
                ? [{
                    id: agentDbId,
                    name: agentName,
                    image: "",
                    bindingId: item.binding.id,
                    enabled: item.binding.enabled,
                  }]
                : []),
            ],
          }
        : connection),
    );
  }

  function updateSharedConnection(connection: DashboardMcpConnection) {
    queryClient.setQueryData<DashboardMcpConnection[]>(
      dashboardKeys.mcpConnections(),
      (current) => current?.map((candidate) => candidate.id === connection.id ? connection : candidate),
    );
    queryClient.setQueriesData<DashboardAgentMcpItem[]>(
      { predicate: (query) => query.queryKey.at(-1) === "mcp-bindings" },
      (current) => current?.map((item) => item.connection.id === connection.id
        ? {
            ...item,
            connection: {
              ...connection,
              attachedAgentCount: item.connection.attachedAgentCount,
            },
          }
        : item),
    );
  }

  async function refreshReferencingBindings(connectionId: string) {
    await queryClient.invalidateQueries({
      predicate: (query) => {
        if (query.queryKey.at(-1) !== "mcp-bindings") return false;
        const items = query.state.data;
        return Array.isArray(items) && items.some((item) => (
          item
          && typeof item === "object"
          && "connection" in item
          && (item as DashboardAgentMcpItem).connection.id === connectionId
        ));
      },
    });
  }

  async function runConnectionAction(item: DashboardAgentMcpItem, action: "verify" | "discover") {
    setBusyId(item.connection.id);
    try {
      const response = await fetch(
        `/api/dashboard/mcp/connections/${encodeURIComponent(item.connection.id)}/${action}`,
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, `MCP ${action} failed`));
      if (body.connection) updateSharedConnection(body.connection as DashboardMcpConnection);
      await refreshReferencingBindings(item.connection.id);
      await queryClient.invalidateQueries({
        queryKey: dashboardKeys.agentMcpTools(agentDbId, item.connection.id),
      });
      showToast(action === "verify" ? "Connection verified" : "Tool catalog refreshed", "success");
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.mcpConnections() });
      await refreshReferencingBindings(item.connection.id);
      showToast(error instanceof Error ? error.message : `MCP ${action} failed`, "error");
    } finally {
      setBusyId(null);
    }
  }

  async function reconnectOAuth(item: DashboardAgentMcpItem) {
    setBusyId(item.connection.id);
    try {
      const response = await fetch(
        `/api/dashboard/mcp/connections/${encodeURIComponent(item.connection.id)}/oauth/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            returnAgentDbId: agentDbId,
            forceReauthorization: true,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not reconnect OAuth"));
      if (typeof body.authorizationUrl === "string") {
        window.location.assign(body.authorizationUrl);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.mcpConnections() });
      await refreshReferencingBindings(item.connection.id);
      showToast("OAuth credentials are already connected", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not reconnect OAuth", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleBinding(item: DashboardAgentMcpItem) {
    const enabled = item.binding?.enabled !== true;
    if (enabled && !item.canEnable) {
      setToggleErrors((current) => ({ ...current, [item.connection.id]: item.enableBlockedReason ?? "This connection cannot be enabled." }));
      return;
    }
    const snapshot = item;
    setToggleErrors((current) => ({ ...current, [item.connection.id]: "" }));
    queryClient.setQueryData<DashboardAgentMcpItem[]>(bindingsKey, (current = []) => current.map((candidate) =>
      candidate.connection.id === item.connection.id
        ? {
            ...candidate,
            binding: optimisticBinding(candidate, enabled),
            enabledToolCount: enabled ? candidate.enabledToolCount : 0,
            highestEnabledRisk: enabled ? candidate.highestEnabledRisk : null,
          }
        : candidate,
    ));
    setBusyId(item.connection.id);
    try {
      const updated = await putBinding(item, {
        enabled,
        ...(item.binding ? { expectedVersion: item.binding.version } : {}),
      });
      queryClient.setQueryData<DashboardAgentMcpItem[]>(bindingsKey, (current = []) => current.map((candidate) =>
        candidate.connection.id === updated.connection.id ? updated : candidate,
      ));
      updateAccountAttachment(updated);
    } catch (error) {
      queryClient.setQueryData<DashboardAgentMcpItem[]>(bindingsKey, (current = []) => current.map((candidate) =>
        candidate.connection.id === snapshot.connection.id ? snapshot : candidate,
      ));
      setToggleErrors((current) => ({
        ...current,
        [item.connection.id]: error instanceof Error ? error.message : "Could not update connection assignment",
      }));
    } finally {
      setBusyId(null);
    }
  }

  async function openConfigure(item: DashboardAgentMcpItem) {
    setBusyId(item.connection.id);
    try {
      let current = item;
      if (!current.binding) {
        current = await putBinding(current, { enabled: false });
        queryClient.setQueryData<DashboardAgentMcpItem[]>(bindingsKey, (items = []) => items.map((candidate) =>
          candidate.connection.id === current.connection.id ? current : candidate,
        ));
        updateAccountAttachment(current);
      }
      const binding = current.binding!;
      setApprovalMode(binding.approvalMode);
      setMaxCalls(binding.maxCallsPerRun);
      setMaxParallel(binding.maxParallelCalls);
      setTimeoutMs(binding.callTimeoutMs);
      setOutputBytes(binding.outputByteLimit);
      setToolSearch("");
      setConfigureItem(current);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open tool policies", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function saveBindingPolicy() {
    if (!configureItem?.binding) return;
    setBusyId(configureItem.connection.id);
    try {
      const updated = await putBinding(configureItem, {
        enabled: configureItem.binding.enabled,
        approvalMode,
        maxCallsPerRun: maxCalls,
        maxParallelCalls: maxParallel,
        callTimeoutMs: timeoutMs,
        outputByteLimit: outputBytes,
        expectedVersion: configureItem.binding.version,
      });
      queryClient.setQueryData<DashboardAgentMcpItem[]>(bindingsKey, (current = []) => current.map((candidate) =>
        candidate.connection.id === updated.connection.id ? updated : candidate,
      ));
      setConfigureItem(updated);
      queryClient.setQueryData<{ binding: DashboardMcpBinding; tools: DashboardMcpTool[] }>(
        dashboardKeys.agentMcpTools(agentDbId, updated.connection.id),
        (current) => current ? { ...current, binding: updated.binding! } : current,
      );
      showToast("Agent connection policy saved", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not save connection policy", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function patchTool(tool: DashboardMcpTool, patch: Record<string, unknown>): Promise<boolean> {
    if (!configureItem) return false;
    const key = dashboardKeys.agentMcpTools(agentDbId, configureItem.connection.id);
    const snapshot = tool;
    setToolBusyId(tool.id);
    queryClient.setQueryData<{ binding: DashboardMcpBinding; tools: DashboardMcpTool[] }>(key, (current) => current ? {
      ...current,
      tools: current.tools.map((candidate) => candidate.id === tool.id ? {
        ...candidate,
        ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
        ...(typeof patch.approvalMode === "string" ? { approvalMode: patch.approvalMode as DashboardMcpApprovalMode, inheritedApproval: false } : {}),
      } : candidate),
    } : current);
    try {
      const response = await fetch(
        `/api/dashboard/agents/${agentDbId}/mcp-bindings/${encodeURIComponent(configureItem.connection.id)}/tools/${encodeURIComponent(tool.id)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not update tool policy"));
      const updatedTool = body.tool as DashboardMcpTool;
      const latest = queryClient.getQueryData<{ binding: DashboardMcpBinding; tools: DashboardMcpTool[] }>(key);
      const nextTools = (latest?.tools ?? []).map((candidate) =>
        candidate.id === tool.id ? updatedTool : candidate);
      queryClient.setQueryData<{ binding: DashboardMcpBinding; tools: DashboardMcpTool[] }>(key, (current) => current ? {
        ...current,
        tools: nextTools,
      } : current);
      const enabledTools = nextTools.filter((candidate) =>
        candidate.active
        && candidate.enabled
        && !candidate.platformBlocked
        && !HARD_BLOCK.has(candidate.effectiveRisk)
        && (!candidate.quarantined || candidate.quarantineAcknowledged));
      queryClient.setQueryData<DashboardAgentMcpItem[]>(bindingsKey, (current = []) => current.map((item) =>
        item.connection.id === configureItem.connection.id && item.binding?.enabled
          ? {
              ...item,
              enabledToolCount: enabledTools.length,
              highestEnabledRisk: RISK_ORDER.find((risk) =>
                enabledTools.some((candidate) => candidate.effectiveRisk === risk)) ?? null,
            }
          : item,
      ));
      return true;
    } catch (error) {
      queryClient.setQueryData<{ binding: DashboardMcpBinding; tools: DashboardMcpTool[] }>(key, (current) => current ? {
        ...current,
        tools: current.tools.map((candidate) => candidate.id === snapshot.id ? snapshot : candidate),
      } : current);
      showToast(error instanceof Error ? error.message : "Could not update tool policy", "error");
      return false;
    } finally {
      setToolBusyId(null);
    }
  }

  async function removeBinding() {
    if (!removeItem) return;
    setBusyId(removeItem.connection.id);
    try {
      const response = await fetch(
        `/api/dashboard/agents/${agentDbId}/mcp-bindings/${encodeURIComponent(removeItem.connection.id)}`,
        { method: "DELETE" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not remove assignment"));
      queryClient.setQueryData<DashboardAgentMcpItem[]>(bindingsKey, (current = []) => current.map((item) =>
        item.connection.id === removeItem.connection.id ? { ...item, binding: null } : item,
      ));
      updateAccountAttachment({ ...removeItem, binding: null });
      queryClient.removeQueries({ queryKey: dashboardKeys.agentMcpTools(agentDbId, removeItem.connection.id) });
      setRemoveItem(null);
      showToast("Connection removed from agent", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not remove assignment", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{agentName}</p>
        <h1 className="ui-page-title">Connections</h1>
        <p className="ui-page-subtitle max-w-2xl">Connect reviewed MCP providers and control which account connections this agent can use without leaving this screen. Credentials remain private and account-owned.</p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">{enabledCount} enabled · {availableCount} available</p>
      </header>

      <section className="space-y-3" aria-labelledby="reviewed-provider-heading">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="reviewed-provider-heading" className="text-sm font-semibold">Reviewed providers</h2>
            <p className="text-xs text-muted-foreground">Choose a reviewed Web3 provider and finish setup for {agentName} here.</p>
          </div>
          {providersQuery.data.customAllowed ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreatorRequest({ id: crypto.randomUUID(), kind: "custom" })}
            >
              <Plus className="mr-1.5 size-4" />Custom remote server
            </Button>
          ) : null}
        </div>
        {providersQuery.isError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{providersQuery.error.message}</p>
        ) : null}
        {providersQuery.data.providers.length > 0 ? (
          <ReviewedMcpProviders
            providers={providersQuery.data.providers}
            onConnect={(provider) => setCreatorRequest({
              id: crypto.randomUUID(),
              kind: "provider",
              provider,
            })}
          />
        ) : (
          <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
            Reviewed provider connections are currently disabled by platform operations. Existing account connections remain available below.
          </p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="agent-connections-heading">
        <div>
          <h2 id="agent-connections-heading" className="text-sm font-semibold">Account connections for {agentName}</h2>
          <p className="text-xs text-muted-foreground">Enable an existing account connection, inspect its status, or configure per-tool policy.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <input aria-label="Search agent connections" className={fieldClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search connections" />
          <select aria-label="Filter assignments" className={fieldClass} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="ALL">All assignments</option><option value="ENABLED">Enabled</option><option value="AVAILABLE">Available</option><option value="BLOCKED">Needs attention</option></select>
          <select aria-label="Filter by provider" className={fieldClass} value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="ALL">All providers</option>{filterOptions.providers.map((provider) => <option key={provider} value={provider}>{readable(provider)}</option>)}</select>
          <select aria-label="Filter by category" className={fieldClass} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="ALL">All categories</option>{filterOptions.categories.map((category) => <option key={category} value={category}>{readable(category)}</option>)}</select>
          <select aria-label="Filter by chain" className={fieldClass} value={chainFilter} onChange={(event) => setChainFilter(event.target.value)}><option value="ALL">All chains</option>{filterOptions.chains.map((chain) => <option key={chain} value={chain}>{readable(chain)}</option>)}</select>
          <select aria-label="Filter by status" className={fieldClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All statuses</option>{filterOptions.statuses.map((status) => <option key={status} value={status}>{readable(status)}</option>)}</select>
          <select aria-label="Filter by risk" className={fieldClass} value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}><option value="ALL">All risks</option>{filterOptions.risks.map((risk) => <option key={risk} value={risk}>{readable(risk)}</option>)}</select>
        </div>

      {bindingsQuery.isError ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{bindingsQuery.error.message}</p> : null}
      {filteredItems.length === 0 ? <div className="rounded-xl border border-dashed border-border p-10 text-center"><p className="text-sm font-medium">No matching connections</p><p className="mt-1 text-xs text-muted-foreground">Adjust the current search and filters, or connect a reviewed provider above.</p><Button className="mt-3" size="sm" variant="outline" onClick={() => { setSearch(""); setFilter("ALL"); setProviderFilter("ALL"); setCategoryFilter("ALL"); setChainFilter("ALL"); setStatusFilter("ALL"); setRiskFilter("ALL"); }}>Reset filters</Button></div> : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const enabled = item.binding?.enabled === true;
            const error = toggleErrors[item.connection.id];
            const availabilityId = `mcp-availability-${item.connection.id}`;
            return <article key={item.connection.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <McpProviderIcon providerKey={item.connection.providerKey} displayName={item.connection.provider?.displayName ?? item.connection.displayName} brand={item.connection.provider?.brand} />
                  <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{item.connection.displayName}</h2><Badge variant={statusVariant(item.connection.status)}>{readable(item.connection.status)}</Badge>{item.connection.unreviewed ? <Badge variant="destructive">Unreviewed</Badge> : null}{item.connection.providerManifestMissing ? <Badge variant="destructive">Provider policy unavailable</Badge> : null}{item.highestEnabledRisk ? <Badge variant={riskVariant(item.highestEnabledRisk)}>{readable(item.highestEnabledRisk)} enabled</Badge> : null}</div>
                  <p className="text-xs text-muted-foreground">{item.connection.provider?.displayName ?? "Custom remote server"}{item.connection.provider?.publisherName ? ` by ${item.connection.provider.publisherName}` : ""}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{item.connection.endpointOrigin}</p>
                  <div className="flex flex-wrap gap-1">{item.connection.provider?.categories.map((category) => <Badge key={category} variant="outline">{readable(category)}</Badge>)}{item.connection.provider?.chainFamilies.map((chain) => <Badge key={chain} variant="secondary">{readable(chain)}</Badge>)}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{item.enabledToolCount} enabled of {item.connection.toolSummary.active} active tools</span><span>{item.connection.toolSummary.quarantined} quarantined</span><span>Used by {item.connection.attachedAgentCount ?? item.connection.attachedAgents.filter((agent) => agent.enabled).length} agents</span><span>Verified {dateLabel(item.connection.lastVerifiedAt)}</span><span>{item.binding?.overriddenToolCount ?? 0} tool overrides</span>{item.binding ? <span>{readable(item.binding.approvalMode)}</span> : <span>Not assigned</span>}</div>
                  {!item.canEnable ? (
                    <p id={availabilityId} className="flex flex-wrap items-center gap-1.5 text-xs text-amber-500">
                      <AlertTriangle className="size-3.5" />
                      {enabled ? "Assigned but currently unavailable: " : null}{item.enableBlockedReason}
                      <Link
                        className="font-medium underline underline-offset-2"
                        href={`/dashboard/connections?focus=${encodeURIComponent(item.connection.id)}`}
                      >Fix account connection</Link>
                    </p>
                  ) : null}
                  {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button asChild size="sm" variant="ghost"><Link href={`/dashboard/connections?focus=${encodeURIComponent(item.connection.id)}`}>Details</Link></Button>
                  <Button size="sm" variant="ghost" disabled={busyId !== null} onClick={() => void runConnectionAction(item, "verify")}><CheckCircle2 className="mr-1 size-3.5" />Verify</Button>
                  {item.connection.credential.authMode === "OAUTH2_AUTHORIZATION_CODE" ? <Button size="sm" variant="ghost" disabled={busyId !== null} onClick={() => void reconnectOAuth(item)}><ExternalLink className="mr-1 size-3.5" />Reconnect</Button> : item.connection.status === "REAUTH_REQUIRED" ? <Button asChild size="sm" variant="ghost"><Link href={`/dashboard/connections?focus=${encodeURIComponent(item.connection.id)}`}><ExternalLink className="mr-1 size-3.5" />Replace key</Link></Button> : null}
                  {item.binding ? <Button size="sm" variant="ghost" disabled={busyId !== null} className="text-destructive" onClick={() => setRemoveItem(item)} aria-label={`Remove ${item.connection.displayName} from ${agentName}`}><Trash2 className="size-4" /></Button> : null}
                  <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => void openConfigure(item)}><SlidersHorizontal className="mr-1.5 size-4" />Configure</Button>
                  <button type="button" role="switch" aria-checked={enabled} aria-label={`Allow ${agentName} to use ${item.connection.displayName}`} aria-describedby={!item.canEnable ? availabilityId : undefined} disabled={busyId !== null || (!enabled && !item.canEnable)} onClick={() => void toggleBinding(item)} className={cn("relative h-7 w-12 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", enabled ? "border-emerald-500 bg-emerald-500" : "border-border bg-muted")}><span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", enabled ? "translate-x-5" : "translate-x-0.5")} />{busyId === item.connection.id ? <span className="sr-only">Saving</span> : null}</button>
                </div>
              </div>
            </article>;
          })}
        </div>
      )}
      </section>

      {creatorRequest ? (
        <AgentMcpConnectionCreator
          key={creatorRequest.id}
          agentDbId={agentDbId}
          agentName={agentName}
          request={creatorRequest}
          onClose={() => setCreatorRequest(null)}
        />
      ) : null}

      <Dialog open={Boolean(configureItem)} onOpenChange={(open) => { if (!open) setConfigureItem(null); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 className="size-4" />Configure {configureItem?.connection.displayName}</DialogTitle><DialogDescription>Binding limits apply to the whole connection. Sparse tool overrides below inherit these defaults until changed.</DialogDescription></DialogHeader>
          {configureItem ? <div className="flex justify-end"><Button size="sm" variant="outline" disabled={busyId !== null || toolBusyId !== null} onClick={() => void runConnectionAction(configureItem, "discover")}><RefreshCw className="mr-1.5 size-3.5" />Refresh catalog</Button></div> : null}
          {configureItem?.binding ? <div className="space-y-5">
            <section className="rounded-lg border border-border p-4 space-y-3"><h3 className="text-sm font-semibold">Agent policy</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><label className="space-y-1 text-xs"><span className="text-muted-foreground">Approval</span><select className={fieldClass} value={approvalMode} onChange={(event) => setApprovalMode(event.target.value as DashboardMcpApprovalMode)}><option value="AUTO_READ_ONLY">Auto read-only</option><option value="CONFIRM_MUTATIONS">Confirm mutations</option><option value="CONFIRM_EVERY_CALL">Confirm every call</option><option value="BLOCK_ALL">Block all</option></select></label><label className="space-y-1 text-xs"><span className="text-muted-foreground">Calls / run</span><input type="number" min={1} max={50} className={fieldClass} value={maxCalls} onChange={(event) => setMaxCalls(Number(event.target.value))} /></label><label className="space-y-1 text-xs"><span className="text-muted-foreground">Parallel calls</span><input type="number" min={1} max={4} className={fieldClass} value={maxParallel} onChange={(event) => setMaxParallel(Number(event.target.value))} /></label><label className="space-y-1 text-xs"><span className="text-muted-foreground">Timeout ms</span><input type="number" min={1000} max={60000} step={1000} className={fieldClass} value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))} /></label><label className="space-y-1 text-xs"><span className="text-muted-foreground">Output bytes</span><input type="number" min={16384} max={1048576} step={16384} className={fieldClass} value={outputBytes} onChange={(event) => setOutputBytes(Number(event.target.value))} /></label></div><div className="flex justify-end"><Button size="sm" disabled={busyId === configureItem.connection.id} onClick={() => void saveBindingPolicy()}>{busyId === configureItem.connection.id ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}Save agent policy</Button></div></section>
            <section className="space-y-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold">Tool policy</h3><p className="text-xs text-muted-foreground">Signing, broadcasting, payment, and custody tools remain blocked regardless of overrides.</p></div><input aria-label="Search tools" className={cn(fieldClass, "sm:w-64")} value={toolSearch} onChange={(event) => setToolSearch(event.target.value)} placeholder="Search tools" /></div>
              {toolsQuery.isLoading ? <div className="flex items-center justify-center p-10 text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading catalog…</div> : null}
              {toolsQuery.isError ? <p className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{toolsQuery.error.message}</p> : null}
              <div className="space-y-3">{groupedTools.map((group) => <details key={group.risk} open className="rounded-lg border border-border"><summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2"><span className="flex items-center gap-2 text-sm font-medium"><Badge variant={riskVariant(group.risk)}>{readable(group.risk)}</Badge>{group.tools.length} tool{group.tools.length === 1 ? "" : "s"}</span><ChevronDown className="size-4 text-muted-foreground" /></summary><div className="divide-y divide-border border-t border-border">{group.tools.map((tool) => {
                const hardBlocked = HARD_BLOCK.has(tool.effectiveRisk);
                const needsReview = tool.quarantined && !tool.quarantineAcknowledged;
                const available = tool.active && !hardBlocked && !needsReview && !tool.platformBlocked;
                return <div key={tool.id} className="space-y-2 px-3 py-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{tool.title || tool.name}</p>{needsReview ? <Badge variant="destructive"><ShieldAlert className="size-3" />Quarantined</Badge> : tool.quarantineAcknowledged ? <Badge variant="secondary">Reviewed</Badge> : null}{!tool.active ? <Badge variant="outline">Removed</Badge> : null}{tool.schemaChanged ? <Badge variant="secondary">Schema changed</Badge> : null}</div><p className="font-mono text-[11px] text-muted-foreground">{tool.name}</p>{tool.description ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Untrusted provider metadata:</span> {tool.description}</p> : null}</div><div className="flex shrink-0 items-center gap-2"><select aria-label={`Approval policy for ${tool.name}`} className={cn(fieldClass, "w-44 py-1.5 text-xs")} value={tool.approvalMode} disabled={!available || toolBusyId !== null} onChange={(event) => void patchTool(tool, { approvalMode: event.target.value })}><option value="AUTO_READ_ONLY">Auto read-only</option><option value="CONFIRM_MUTATIONS">Confirm mutations</option><option value="CONFIRM_EVERY_CALL">Confirm every call</option><option value="BLOCK_ALL">Block all</option></select><button type="button" role="switch" aria-checked={tool.enabled && available} aria-label={`${tool.enabled ? "Disable" : "Enable"} ${tool.name}`} disabled={!available || toolBusyId !== null} onClick={() => void patchTool(tool, { enabled: !tool.enabled })} className={cn("relative h-6 w-10 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40", tool.enabled && available ? "border-emerald-500 bg-emerald-500" : "border-border bg-muted")}><span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform", tool.enabled && available ? "translate-x-[18px]" : "translate-x-0.5")} /></button></div></div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground"><span>Schema {tool.schemaHash.slice(0, 10)}…</span><span>Required: {tool.inputSummary.required.join(", ") || "none"}</span><span>Input: {tool.inputSummary.fields.join(", ") || "none"}</span><span>Output: {tool.outputSummary?.fields.join(", ") || tool.outputSummary?.type || "unspecified"}</span><span>Discovered {dateLabel(tool.lastDiscoveredAt)}</span>{tool.inheritedApproval ? <span>Inherits agent approval</span> : <button disabled={toolBusyId !== null} className="inline-flex items-center gap-1 text-foreground hover:underline disabled:opacity-50" onClick={() => void patchTool(tool, { reset: true })}><RotateCcw className="size-3" />Reset override</button>}{needsReview && !hardBlocked && !tool.platformBlocked && tool.active ? <Button size="sm" variant="outline" disabled={toolBusyId !== null} className="h-6 px-2 text-[11px]" onClick={() => { setReviewTool(tool); setReviewConfirmed(false); }}>Review change</Button> : null}</div>
                {tool.riskReason ? <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Risk reason:</span> {tool.riskReason}</p> : null}
                {tool.platformBlocked ? <p className="text-xs text-destructive">{tool.quarantineReason ?? "This tool is disabled by platform operations."}</p> : hardBlocked ? <p className="text-xs text-destructive">This risk class is hard-blocked from the generic MCP runtime.</p> : tool.quarantineReason ? <p className="text-xs text-amber-500">{tool.quarantineReason}</p> : null}
              </div>;
              })}</div></details>)}</div>
            </section>
          </div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setConfigureItem(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reviewTool)} onOpenChange={(open) => { if (!open) setReviewTool(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Review changed tool schema</DialogTitle><DialogDescription>The provider changed this tool’s schema or effective risk. Review the current fields and risk before removing quarantine for this agent.</DialogDescription></DialogHeader>{reviewTool ? <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><p className="font-medium">{reviewTool.title || reviewTool.name}</p><p className="font-mono text-xs">{reviewTool.name}</p><p className="text-xs text-muted-foreground">Risk: {readable(reviewTool.effectiveRisk)} · Schema: {reviewTool.schemaHash}</p><p className="text-xs text-muted-foreground">Required fields: {reviewTool.inputSummary.required.join(", ") || "none"}</p><label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} /><span>I reviewed this exact schema hash and want to allow this tool through the generic runtime.</span></label></div> : null}<DialogFooter><Button variant="outline" onClick={() => setReviewTool(null)}>Cancel</Button><Button disabled={!reviewConfirmed || !reviewTool || toolBusyId !== null} onClick={() => { if (!reviewTool) return; const current = reviewTool; void patchTool(current, { enabled: true, acknowledgeSchemaHash: current.schemaHash }).then((saved) => { if (saved) setReviewTool(null); }); }}>Acknowledge and enable</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={Boolean(removeItem)} onOpenChange={(open) => { if (!open) setRemoveItem(null); }}><DialogContent><DialogHeader><DialogTitle>Remove connection from {agentName}?</DialogTitle><DialogDescription>This deletes the agent binding and all of its sparse tool overrides. The account connection and encrypted credential are not deleted.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setRemoveItem(null)}>Cancel</Button><Button variant="destructive" disabled={!removeItem || busyId === removeItem.connection.id} onClick={() => void removeBinding()}>{busyId === removeItem?.connection.id ? "Removing…" : "Remove assignment"}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
