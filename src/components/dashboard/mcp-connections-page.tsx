"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  ShieldAlert,
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
import { showToast } from "@/components/ui/toast-simple";
import { McpProviderIcon, ReviewedMcpProviders } from "@/components/dashboard/mcp-reviewed-providers";
import type {
  DashboardAgentMcpItem,
  DashboardMcpApprovalMode,
  DashboardMcpConnection,
  DashboardMcpProvider,
  DashboardMcpProviderAuth,
} from "@/features/agent-chat/shared/mcp-dashboard-types";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import { cn } from "@/lib/utils";

type Props = {
  initialConnections: DashboardMcpConnection[];
  initialProviders: DashboardMcpProvider[];
  initialCustomConnectionsAllowed: boolean;
  availableAgents: Array<{ id: number; name: string }>;
  contextAgentId: number | null;
  initialUrlState: {
    oauthResult: "connected" | "error" | "auth-session-required" | null;
    oauthCode: string | null;
    oauthConnectionId: string | null;
    focusConnectionId: string | null;
  };
};

type AuthKind = DashboardMcpProviderAuth["kind"];

const fieldClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring";
const WIZARD_STEPS = [
  "Provider",
  "Access",
  "Authenticate",
  "Verify",
  "Tools",
  "Assign",
  "Complete",
] as const;
const PROVIDER_GROUP_ORDER = [
  "Market & fundamentals",
  "Research & social",
  "On-chain & wallets",
  "Infrastructure & simulation",
  "Execution & wallets",
  "Watchlist",
] as const;

function providerGroup(provider: DashboardMcpProvider): (typeof PROVIDER_GROUP_ORDER)[number] {
  if (!provider.connectable || provider.priority === "WATCH") return "Watchlist";
  if (provider.priority === "ACTION") return "Execution & wallets";
  if (provider.categories.some((category) => ["crypto-research", "social-intelligence"].includes(category))) return "Research & social";
  if (provider.categories.some((category) => [
    "rpc-infrastructure",
    "developer-infrastructure",
    "simulation",
  ].includes(category))) return "Infrastructure & simulation";
  if (provider.categories.some((category) => ["onchain-analytics", "onchain-data", "indexed-chain-data", "data-warehouse", "wallet-portfolio", "explorer", "subgraph-data"].includes(category))) return "On-chain & wallets";
  return "Market & fundamentals";
}

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

function statusTone(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "READY") return "default";
  if (status === "DEGRADED" || status === "AUTH_PENDING" || status === "REAUTH_REQUIRED") {
    return "secondary";
  }
  if (["INVALID", "BLOCKED", "DELETED"].includes(status)) return "destructive";
  return "outline";
}

function isGloballyDisabled(connection: DashboardMcpConnection): boolean {
  // disabledAt is authoritative when a recovery status (for example BLOCKED or
  // REAUTH_REQUIRED) must remain visible alongside account-wide suspension.
  return Boolean(connection.disabledAt) || connection.status === "DISABLED";
}

function readable(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: Date | string | null): string {
  if (!value) return "Never";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function authLabel(auth: DashboardMcpProviderAuth): string {
  if (auth.kind === "api-key-header") return `API key (${auth.headerName ?? "reviewed header"})`;
  if (auth.kind === "api-key-query") return "API key (secure URL injection)";
  if (auth.kind === "api-key-tool-argument") return "API key (secure tool injection)";
  if (auth.kind === "oauth2") return "OAuth authorization";
  if (auth.kind === "client-credentials") return "OAuth client credentials";
  if (auth.kind === "bearer") return "Bearer token";
  return "No authentication";
}

function authMode(kind: AuthKind): string {
  if (kind === "api-key-header") return "API_KEY_HEADER";
  if (kind === "api-key-query") return "API_KEY_QUERY";
  if (kind === "api-key-tool-argument") return "API_KEY_TOOL_ARGUMENT";
  if (kind === "oauth2") return "OAUTH2_AUTHORIZATION_CODE";
  if (kind === "client-credentials") return "OAUTH2_CLIENT_CREDENTIALS";
  if (kind === "bearer") return "BEARER_TOKEN";
  return "NONE";
}

function connectionAuthKind(connection: DashboardMcpConnection): AuthKind {
  if (connection.credential.authMode === "API_KEY_HEADER") return "api-key-header";
  if (connection.credential.authMode === "API_KEY_QUERY") return "api-key-query";
  if (connection.credential.authMode === "API_KEY_TOOL_ARGUMENT") return "api-key-tool-argument";
  if (connection.credential.authMode === "OAUTH2_AUTHORIZATION_CODE") return "oauth2";
  if (connection.credential.authMode === "OAUTH2_CLIENT_CREDENTIALS") return "client-credentials";
  if (connection.credential.authMode === "BEARER_TOKEN") return "bearer";
  return "none";
}

export function McpConnectionsPage({
  initialConnections,
  initialProviders,
  initialCustomConnectionsAllowed,
  availableAgents,
  contextAgentId,
  initialUrlState,
}: Props) {
  const initialCompletedConnection = initialUrlState.oauthResult === "connected"
    && initialUrlState.oauthConnectionId
    ? initialConnections.find((connection) => connection.id === initialUrlState.oauthConnectionId) ?? null
    : null;
  const initialFocusedConnection = !initialCompletedConnection && initialUrlState.focusConnectionId
    ? initialConnections.find((connection) => connection.id === initialUrlState.focusConnectionId) ?? null
    : null;
  const queryClient = useQueryClient();
  const connectionsQuery = useQuery({
    queryKey: dashboardKeys.mcpConnections(),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/dashboard/mcp/connections", { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not load MCP connections"));
      return (body.connections ?? []) as DashboardMcpConnection[];
    },
    initialData: initialConnections,
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

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [wizardOpen, setWizardOpen] = useState(Boolean(initialCompletedConnection));
  const [wizardStep, setWizardStep] = useState(initialCompletedConnection ? 5 : 1);
  const [completedConnectionId, setCompletedConnectionId] = useState<string | null>(
    initialCompletedConnection?.id ?? null,
  );
  const [assignAgentId, setAssignAgentId] = useState(contextAgentId ? String(contextAgentId) : "");
  const [initialApprovalMode, setInitialApprovalMode] = useState<DashboardMcpApprovalMode>(
    initialCompletedConnection?.provider?.defaultBindingPolicy.approvalMode ?? "AUTO_READ_ONLY",
  );
  const [providerKey, setProviderKey] = useState<string | null>(initialFocusedConnection?.providerKey ?? null);
  const [displayName, setDisplayName] = useState(initialFocusedConnection?.displayName ?? "");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [selectedAuth, setSelectedAuth] = useState<AuthKind>(
    initialFocusedConnection ? connectionAuthKind(initialFocusedConnection) : "none",
  );
  const [transport, setTransport] = useState<"STREAMABLE_HTTP" | "LEGACY_SSE">(
    initialFocusedConnection?.transport ?? "STREAMABLE_HTTP",
  );
  const [secret, setSecret] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tokenEndpoint, setTokenEndpoint] = useState("");
  const [scope, setScope] = useState("");
  const [expectedIssuer, setExpectedIssuer] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manageConnection, setManageConnection] = useState<DashboardMcpConnection | null>(
    initialFocusedConnection,
  );
  const [deleteConnection, setDeleteConnection] = useState<DashboardMcpConnection | null>(null);
  const [deleteDetach, setDeleteDetach] = useState(false);
  const [disableConnection, setDisableConnection] = useState<DashboardMcpConnection | null>(null);
  const [replaceCredential, setReplaceCredential] = useState(false);

  const selectedProvider = providerKey
    ? providersQuery.data.providers.find((provider) => provider.key === providerKey)
      ?? (manageConnection?.providerKey === providerKey ? manageConnection.provider : null)
    : null;
  const availableAuth = selectedProvider?.authOptions ?? [
    { kind: "none" as const },
    { kind: "bearer" as const },
    { kind: "api-key-header" as const },
    { kind: "oauth2" as const },
    { kind: "client-credentials" as const },
  ];
  const completedConnection = completedConnectionId
    ? connectionsQuery.data.find((connection) => connection.id === completedConnectionId) ?? null
    : null;
  const contextAgent = contextAgentId
    ? availableAgents.find((agent) => agent.id === contextAgentId) ?? null
    : null;

  const filteredConnections = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return connectionsQuery.data.filter((connection) => {
      if (
        statusFilter !== "ALL"
        && (statusFilter === "DISABLED"
          ? !isGloballyDisabled(connection)
          : connection.status !== statusFilter)
      ) return false;
      if (!needle) return true;
      return [
        connection.displayName,
        connection.endpointHost,
        connection.provider?.publisherName ?? "custom",
        ...connection.attachedAgents.map((agent) => agent.name),
      ].join(" ").toLowerCase().includes(needle);
    });
  }, [connectionsQuery.data, search, statusFilter]);
  const wizardProviderGroups = useMemo(() => PROVIDER_GROUP_ORDER.map((label) => ({
    label,
    providers: providersQuery.data.providers.filter((provider) => providerGroup(provider) === label),
  })).filter((group) => group.providers.length > 0), [providersQuery.data.providers]);
  const invalidateVisibleAgentBindings = useCallback(async (connectionId: string) => {
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
  }, [queryClient]);

  useEffect(() => {
    const result = initialUrlState.oauthResult;
    const focus = initialUrlState.focusConnectionId;
    if (!result && !focus) return;
    const url = new URL(window.location.href);
    if (result) {
      if (result === "connected") {
        showToast("MCP OAuth connected and catalog discovered", "success");
      } else {
        showToast(`MCP OAuth failed${initialUrlState.oauthCode ? `: ${initialUrlState.oauthCode}` : ""}`, "error");
      }
      url.searchParams.delete("mcp");
      url.searchParams.delete("code");
      url.searchParams.delete("connectionId");
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.mcpConnections() });
      if (initialUrlState.oauthConnectionId) {
        void invalidateVisibleAgentBindings(initialUrlState.oauthConnectionId);
      }
    }
    if (focus) url.searchParams.delete("focus");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [
    initialUrlState.focusConnectionId,
    initialUrlState.oauthCode,
    initialUrlState.oauthConnectionId,
    initialUrlState.oauthResult,
    invalidateVisibleAgentBindings,
    queryClient,
  ]);

  function selectWizardProvider(provider: DashboardMcpProvider | null) {
    setProviderKey(provider?.key ?? null);
    setDisplayName(provider?.displayName ?? "");
    setEndpointUrl("");
    setSelectedAuth(provider?.auth.kind ?? "none");
    setTransport(provider?.transports[0] === "legacy-sse" ? "LEGACY_SSE" : "STREAMABLE_HTTP");
    setSecret("");
    setHeaderName("");
    setPrefix("");
    setClientId("");
    setClientSecret("");
    setTokenEndpoint("");
    setScope("");
    setExpectedIssuer("");
    setReplaceCredential(false);
    setIdempotencyKey(crypto.randomUUID());
    setInitialApprovalMode(provider?.defaultBindingPolicy.approvalMode ?? "CONFIRM_EVERY_CALL");
    setCompletedConnectionId(null);
  }

  function openWizard(provider?: DashboardMcpProvider | null) {
    if (provider && !provider.connectable) {
      showToast(provider.unavailableReason ?? "This provider is not available for connections", "error");
      return;
    }
    selectWizardProvider(provider ?? null);
    setAssignAgentId(contextAgentId ? String(contextAgentId) : "");
    setWizardStep(provider ? 2 : 1);
    setWizardOpen(true);
  }

  function credentialPayload() {
    if (selectedAuth === "api-key-header") {
      return {
        kind: "api-key-header",
        value: secret,
        ...(headerName.trim() ? { headerName: headerName.trim() } : {}),
        ...(prefix ? { prefix } : {}),
      };
    }
    if (selectedAuth === "api-key-query" || selectedAuth === "api-key-tool-argument") {
      return { kind: selectedAuth, value: secret };
    }
    if (selectedAuth === "bearer") return { kind: "bearer", token: secret };
    if (selectedAuth === "oauth2") return { kind: "oauth2-authorization-code" };
    if (selectedAuth === "client-credentials") {
      return {
        kind: "oauth2-client-credentials",
        clientId,
        clientSecret,
        ...(!selectedProvider && tokenEndpoint.trim() ? { tokenEndpoint: tokenEndpoint.trim() } : {}),
        ...(scope.trim() ? { scope: scope.trim() } : {}),
        ...(expectedIssuer.trim() ? { expectedIssuer: expectedIssuer.trim() } : {}),
      };
    }
    return { kind: "none" };
  }

  async function startOAuth(
    connectionId: string,
    returnAgentDbId?: number,
    forceReauthorization = false,
  ) {
    const response = await fetch(`/api/dashboard/mcp/connections/${encodeURIComponent(connectionId)}/oauth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(returnAgentDbId ? { returnAgentDbId } : {}),
        ...(forceReauthorization ? { forceReauthorization: true } : {}),
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(apiMessage(body, "Could not start OAuth"));
    if (body.authorizationUrl) {
      window.location.assign(body.authorizationUrl as string);
      return true;
    }
    await queryClient.invalidateQueries({ queryKey: dashboardKeys.mcpConnections() });
    await invalidateVisibleAgentBindings(connectionId);
    showToast("OAuth credentials are already connected", "success");
    return false;
  }

  async function reconnectOAuth(connection: DashboardMcpConnection) {
    setBusyId(connection.id);
    try {
      await startOAuth(connection.id, undefined, true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not reconnect OAuth", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function createConnection() {
    if (!displayName.trim()) return;
    if (!selectedProvider && !endpointUrl.trim()) {
      showToast("Enter an HTTPS MCP endpoint", "error");
      return;
    }
    if (selectedProvider && !selectedProvider.connectable) {
      showToast(selectedProvider.unavailableReason ?? "This provider cannot be connected", "error");
      return;
    }
    if (["api-key-header", "api-key-query", "api-key-tool-argument", "bearer"].includes(selectedAuth) && !secret) {
      showToast("Enter the credential value", "error");
      return;
    }
    if (selectedAuth === "client-credentials" && (!clientId || !clientSecret)) {
      showToast("Enter the OAuth client ID and secret", "error");
      return;
    }
    if (selectedAuth === "client-credentials" && !selectedProvider && (!tokenEndpoint || !expectedIssuer)) {
      showToast("Enter the exact OAuth token endpoint and issuer", "error");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/dashboard/mcp/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerKey,
          displayName: displayName.trim(),
          ...(selectedProvider ? {} : { endpointUrl: endpointUrl.trim() }),
          credential: credentialPayload(),
          transportMode: transport,
          idempotencyKey,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not create MCP connection"));
      setSecret("");
      setClientSecret("");
      setTokenEndpoint("");
      const connection = body.connection as DashboardMcpConnection;
      queryClient.setQueryData<DashboardMcpConnection[]>(dashboardKeys.mcpConnections(), (current = []) => [
        connection,
        ...current.filter((item) => item.id !== connection.id),
      ]);
      setCompletedConnectionId(connection.id);
      if (selectedAuth === "oauth2") {
        const redirecting = await startOAuth(connection.id, contextAgentId ?? undefined);
        if (!redirecting) setWizardStep(5);
      } else {
        setWizardStep(5);
        showToast(
          body.verification?.ok
            ? "MCP connection verified"
            : "Connection saved; review the verification result",
          body.verification?.ok ? "success" : "error",
        );
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not create MCP connection", "error");
    } finally {
      setCreating(false);
    }
  }

  async function finishAssignment() {
    if (!completedConnection) return;
    if (!assignAgentId) {
      setWizardStep(7);
      return;
    }
    const agentId = Number(assignAgentId);
    setCreating(true);
    try {
      const response = await fetch(
        `/api/dashboard/agents/${agentId}/mcp-bindings/${encodeURIComponent(completedConnection.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true, approvalMode: initialApprovalMode }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not assign connection to agent"));
      const updatedItem = body.item as DashboardAgentMcpItem;
      queryClient.setQueryData<DashboardAgentMcpItem[]>(
        dashboardKeys.agentMcpBindings(agentId),
        (current = []) => [
          updatedItem,
          ...current.filter((item) => item.connection.id !== completedConnection.id),
        ],
      );
      const agent = availableAgents.find((candidate) => candidate.id === agentId);
      if (agent) {
        replaceConnection({
          ...completedConnection,
          attachedAgents: [
            ...completedConnection.attachedAgents.filter((item) => item.id !== agentId),
            {
              id: agentId,
              name: agent.name,
              image: "",
              bindingId: updatedItem.binding?.id ?? `binding:${agentId}`,
              enabled: true,
            },
          ],
        });
      }
      setWizardStep(7);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not assign connection to agent", "error");
    } finally {
      setCreating(false);
    }
  }

  function replaceConnection(connection: DashboardMcpConnection) {
    queryClient.setQueryData<DashboardMcpConnection[]>(dashboardKeys.mcpConnections(), (current = []) =>
      current.map((item) => item.id === connection.id ? connection : item),
    );
    queryClient.setQueriesData<DashboardAgentMcpItem[]>(
      {
        predicate: (query) => query.queryKey.at(-1) === "mcp-bindings",
      },
      (current) => current?.map((item) => item.connection.id === connection.id
        ? { ...item, connection }
        : item),
    );
  }

  async function runConnectionAction(connection: DashboardMcpConnection, action: "verify" | "discover") {
    setBusyId(connection.id);
    try {
      const response = await fetch(
        `/api/dashboard/mcp/connections/${encodeURIComponent(connection.id)}/${action}`,
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, `MCP ${action} failed`));
      if (body.connection) replaceConnection(body.connection as DashboardMcpConnection);
      await invalidateVisibleAgentBindings(connection.id);
      showToast(action === "verify" ? "Connection verified" : "Tool catalog refreshed", "success");
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.mcpConnection(connection.id) });
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.mcpConnections() });
      await invalidateVisibleAgentBindings(connection.id);
      showToast(error instanceof Error ? error.message : `MCP ${action} failed`, "error");
    } finally {
      setBusyId(null);
    }
  }

  async function setDisabled(connection: DashboardMcpConnection, disabled: boolean) {
    const previous = connectionsQuery.data;
    setBusyId(connection.id);
    queryClient.setQueryData<DashboardMcpConnection[]>(dashboardKeys.mcpConnections(), (current = []) =>
      current.map((item) => item.id === connection.id
        ? {
            ...item,
            status: disabled
              ? ["BLOCKED", "REAUTH_REQUIRED", "INVALID"].includes(item.status)
                ? item.status
                : "DISABLED"
              : item.status === "DISABLED" ? "DRAFT" : item.status,
            disabledAt: disabled ? new Date().toISOString() : null,
          }
        : item),
    );
    try {
      const response = await fetch(`/api/dashboard/mcp/connections/${encodeURIComponent(connection.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": `\"${connection.version}\"` },
        body: JSON.stringify({ disabled }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not update connection"));
      setSecret("");
      setClientSecret("");
      replaceConnection(body.connection as DashboardMcpConnection);
      await invalidateVisibleAgentBindings(connection.id);
    } catch (error) {
      queryClient.setQueryData(dashboardKeys.mcpConnections(), previous);
      showToast(error instanceof Error ? error.message : "Could not update connection", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteConnection) return;
    setBusyId(deleteConnection.id);
    try {
      const suffix = deleteDetach ? "?detach=true" : "";
      const response = await fetch(`/api/dashboard/mcp/connections/${encodeURIComponent(deleteConnection.id)}${suffix}`, {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not delete connection"));
      queryClient.setQueryData<DashboardMcpConnection[]>(dashboardKeys.mcpConnections(), (current = []) =>
        current.filter((item) => item.id !== deleteConnection.id),
      );
      queryClient.setQueriesData<DashboardAgentMcpItem[]>(
        { predicate: (query) => query.queryKey.at(-1) === "mcp-bindings" },
        (current) => current?.filter((item) => item.connection.id !== deleteConnection.id),
      );
      queryClient.removeQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return key.includes(deleteConnection.id)
            && (key.includes("mcp-connections") || key.includes("mcp-bindings"));
        },
      });
      setDeleteConnection(null);
      setDeleteDetach(false);
      showToast("Connection deleted", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not delete connection", "error");
    } finally {
      setBusyId(null);
    }
  }

  function openManage(connection: DashboardMcpConnection) {
    setManageConnection(connection);
    setProviderKey(connection.providerKey);
    setDisplayName(connection.displayName);
    setSelectedAuth(connectionAuthKind(connection));
    setTransport(connection.transport);
    setSecret("");
    setHeaderName("");
    setPrefix("");
    setClientId("");
    setClientSecret("");
    setTokenEndpoint("");
    setScope("");
    setExpectedIssuer("");
    setReplaceCredential(false);
  }

  async function saveManage() {
    if (!manageConnection) return;
    setBusyId(manageConnection.id);
    try {
      const changingAuthMode = authMode(selectedAuth) !== manageConnection.credential.authMode;
      if ((replaceCredential || changingAuthMode) && ["api-key-header", "api-key-query", "api-key-tool-argument", "bearer"].includes(selectedAuth) && !secret) {
        throw new Error("Enter the replacement credential value");
      }
      if ((replaceCredential || changingAuthMode) && selectedAuth === "client-credentials" && (!clientId || !clientSecret)) {
        throw new Error("Enter both the replacement OAuth client ID and client secret");
      }
      const patch: Record<string, unknown> = {
        displayName: displayName.trim(),
      };
      if (!manageConnection.providerManifestMissing) {
        patch.authMode = authMode(selectedAuth);
        patch.transportMode = transport;
        if (selectedAuth === "api-key-header" && secret) {
          patch.apiKey = secret;
          if (headerName.trim()) patch.apiKeyHeaderName = headerName.trim();
          if (prefix) patch.apiKeyPrefix = prefix;
        } else if (["api-key-query", "api-key-tool-argument"].includes(selectedAuth) && secret) {
          patch.apiKey = secret;
        } else if (selectedAuth === "bearer" && secret) {
          patch.bearerToken = secret;
        } else if (selectedAuth === "client-credentials" && (clientId || clientSecret)) {
          if (!clientId || !clientSecret) throw new Error("Enter both the OAuth client ID and client secret");
          if (!selectedProvider && (!tokenEndpoint || !expectedIssuer)) {
            throw new Error("Enter the exact OAuth token endpoint and issuer");
          }
          patch.clientId = clientId;
          patch.clientSecret = clientSecret;
          if (!selectedProvider) patch.tokenEndpoint = tokenEndpoint;
          patch.scope = scope;
          if (expectedIssuer.trim()) patch.expectedIssuer = expectedIssuer.trim();
        }
      }
      const response = await fetch(`/api/dashboard/mcp/connections/${encodeURIComponent(manageConnection.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": `\"${manageConnection.version}\"` },
        body: JSON.stringify(patch),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not update connection"));
      setSecret("");
      setClientSecret("");
      setTokenEndpoint("");
      setReplaceCredential(false);
      const updated = body.connection as DashboardMcpConnection;
      replaceConnection(updated);
      await invalidateVisibleAgentBindings(updated.id);
      setManageConnection(null);
      showToast("Connection settings saved", "success");
      if (
        !manageConnection.providerManifestMissing
        && selectedAuth === "oauth2"
        && updated.status !== "READY"
      ) await startOAuth(updated.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not update connection", "error");
    } finally {
      setBusyId(null);
    }
  }

  const credentialFields = (isRotation: boolean) => {
    const replaceableCurrentCredential = isRotation
      && manageConnection
      && authMode(selectedAuth) === manageConnection.credential.authMode
      && ["api-key-header", "api-key-query", "api-key-tool-argument", "bearer", "client-credentials"].includes(selectedAuth);
    if (replaceableCurrentCredential && !replaceCredential) {
      const label = ["api-key-header", "api-key-query", "api-key-tool-argument"].includes(selectedAuth)
        ? "Replace API key"
        : selectedAuth === "bearer"
          ? "Replace bearer token"
          : "Replace OAuth client credentials";
      return <div className="rounded-md border border-border p-3"><p className="text-xs text-muted-foreground">The saved credential remains write-only and is not loaded into this form.</p><Button className="mt-2" size="sm" type="button" variant="outline" onClick={() => setReplaceCredential(true)}>{label}</Button></div>;
    }
    return <div className="space-y-3">
      {selectedAuth === "api-key-header" ? (
        <>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">API key</span>
            <input type="password" autoComplete="off" className={fieldClass} value={secret} onChange={(event) => setSecret(event.target.value)} />
          </label>
          {!selectedProvider ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs"><span className="text-muted-foreground">Header name</span><input className={fieldClass} value={headerName} onChange={(event) => setHeaderName(event.target.value)} placeholder="X-API-Key" /></label>
              <label className="space-y-1 text-xs"><span className="text-muted-foreground">Value prefix (optional)</span><input className={fieldClass} value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="Bearer " /></label>
            </div>
          ) : null}
        </>
      ) : null}
      {selectedAuth === "api-key-query" || selectedAuth === "api-key-tool-argument" ? (
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">API key</span>
          <input type="password" autoComplete="off" className={fieldClass} value={secret} onChange={(event) => setSecret(event.target.value)} />
          <span className="block text-[11px] text-muted-foreground">Injected only at the reviewed server boundary; it is never added to the stored endpoint or model-visible tool input.</span>
        </label>
      ) : null}
      {selectedAuth === "bearer" ? (
        <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Bearer token</span><input type="password" autoComplete="off" className={fieldClass} value={secret} onChange={(event) => setSecret(event.target.value)} /></label>
      ) : null}
      {selectedAuth === "client-credentials" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs"><span className="text-muted-foreground">Client ID</span><input autoComplete="off" className={fieldClass} value={clientId} onChange={(event) => setClientId(event.target.value)} /></label>
          <label className="space-y-1 text-xs"><span className="text-muted-foreground">Client secret</span><input type="password" autoComplete="off" className={fieldClass} value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} /></label>
          {!selectedProvider ? <label className="space-y-1 text-xs"><span className="text-muted-foreground">Exact token endpoint</span><input type="url" className={fieldClass} value={tokenEndpoint} onChange={(event) => setTokenEndpoint(event.target.value)} placeholder="https://auth.example.com/oauth/token" /></label> : null}
          {!selectedProvider ? <label className="space-y-1 text-xs"><span className="text-muted-foreground">Expected issuer</span><input type="url" className={fieldClass} value={expectedIssuer} onChange={(event) => setExpectedIssuer(event.target.value)} placeholder="https://auth.example.com" /></label> : null}
          {!selectedProvider ? <label className="space-y-1 text-xs"><span className="text-muted-foreground">Scope (optional)</span><input className={fieldClass} value={scope} onChange={(event) => setScope(event.target.value)} /></label> : <p className="self-end text-xs text-muted-foreground">Requested scopes: {selectedProvider.authOptions.find((auth) => auth.kind === "client-credentials")?.scopes?.join(" ") || "provider default"}</p>}
        </div>
      ) : null}
      {selectedAuth === "oauth2" ? <p className="text-xs text-muted-foreground">You will be redirected to the provider. OAuth state, PKCE, issuer, audience, and resource binding are checked server-side.</p> : null}
    </div>;
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Account infrastructure</p>
          <h1 className="ui-page-title">Connections</h1>
          <p className="ui-page-subtitle max-w-2xl">Connect reviewed remote MCP providers once, then explicitly enable and configure them for each agent.</p>
        </div>
        <Button
          disabled={providersQuery.data.providers.length === 0 && !providersQuery.data.customAllowed}
          onClick={() => openWizard()}
        ><Plus className="mr-1.5 size-4" />Add connection</Button>
      </header>

      {providersQuery.data.providers.length === 0 && !providersQuery.data.customAllowed ? (
        <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
          Creating new MCP connections is currently disabled by platform operations. Existing connections remain visible below.
        </p>
      ) : null}

      <section className="space-y-3" aria-labelledby="provider-heading">
        <div className="flex items-center justify-between">
          <h2 id="provider-heading" className="text-sm font-semibold">Reviewed providers</h2>
          <span className="text-xs text-muted-foreground">Server-maintained manifests</span>
        </div>
        <ReviewedMcpProviders
          providers={providersQuery.data.providers}
          onConnect={(provider) => openWizard(provider)}
        />
      </section>

      <section className="space-y-3" aria-labelledby="connections-heading">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 id="connections-heading" className="text-sm font-semibold">Your connections</h2><p className="text-xs text-muted-foreground">Credentials are account-owned and never exposed to agents or browsers.</p></div>
          <div className="flex gap-2">
            <input aria-label="Search connections" className={cn(fieldClass, "w-48")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" />
            <select aria-label="Filter by status" className={fieldClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="ALL">All statuses</option>
              {["READY", "DEGRADED", "REAUTH_REQUIRED", "AUTH_PENDING", "INVALID", "BLOCKED", "DISABLED", "DRAFT"].map((status) => <option key={status} value={status}>{readable(status)}</option>)}
            </select>
          </div>
        </div>
        {connectionsQuery.isError ? <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{connectionsQuery.error.message}</p> : null}
        {filteredConnections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium">{connectionsQuery.data.length === 0 ? "No account connections yet" : "No matching connections"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{connectionsQuery.data.length === 0 ? "Remote MCP connections are reusable across your agents while credentials remain account-owned." : "Your current search and status filter are preserved until you reset them."}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {connectionsQuery.data.length === 0 ? <Button asChild size="sm" variant="outline"><a href="#provider-heading">Browse Web3 connections</a></Button> : null}
              {connectionsQuery.data.length === 0 && providersQuery.data.customAllowed ? <Button size="sm" variant="outline" onClick={() => { selectWizardProvider(null); setWizardStep(2); setWizardOpen(true); }}>Add custom remote server</Button> : null}
              {connectionsQuery.data.length > 0 ? <Button size="sm" variant="outline" onClick={() => { setSearch(""); setStatusFilter("ALL"); }}>Reset filters</Button> : null}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredConnections.map((connection) => (
              <article key={connection.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <McpProviderIcon providerKey={connection.providerKey} displayName={connection.provider?.displayName ?? connection.displayName} brand={connection.provider?.brand} />
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{connection.displayName}</h3><Badge variant={statusTone(connection.status)}>{readable(connection.status)}</Badge>{isGloballyDisabled(connection) && connection.status !== "DISABLED" ? <Badge variant="outline">Globally disabled</Badge> : null}{connection.unreviewed ? <Badge variant="destructive">Unreviewed</Badge> : null}{connection.providerManifestMissing ? <Badge variant="destructive">Provider policy unavailable</Badge> : null}</div><p className="mt-1 truncate font-mono text-xs text-muted-foreground">{connection.endpointOrigin}</p></div>
                  </div>
                  <Button size="sm" variant="ghost" disabled={busyId !== null} onClick={() => openManage(connection)} aria-label={`Manage ${connection.displayName}`}><Settings2 className="size-4" /></Button>
                </div>
                {connection.statusMessage ? <p className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">{connection.statusMessage}</p> : null}
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div><p className="text-muted-foreground">Tools</p><p className="font-medium">{connection.toolSummary.active}</p></div>
                  <div><p className="text-muted-foreground">Highest risk</p><p className="font-medium">{connection.toolSummary.highestRisk ? readable(connection.toolSummary.highestRisk) : "—"}</p></div>
                  <div><p className="text-muted-foreground">Agents</p><p className="font-medium">{connection.attachedAgents.filter((agent) => agent.enabled).length} enabled</p></div>
                  <div><p className="text-muted-foreground">Auth</p><p className="font-medium truncate">{connection.credential.label}</p>{connection.credential.expiresAt ? <p className="text-[10px] text-muted-foreground">expires {dateLabel(connection.credential.expiresAt)}</p> : null}</div>
                </div>
                {connection.toolSummary.quarantined > 0 ? <p className="flex items-center gap-1.5 text-xs text-amber-500"><ShieldAlert className="size-3.5" />{connection.toolSummary.quarantined} tool{connection.toolSummary.quarantined === 1 ? "" : "s"} quarantined after catalog changes</p> : null}
                {connection.attachedAgents.length > 0 ? <div className="flex flex-wrap gap-1">{connection.attachedAgents.map((agent) => <Badge key={agent.bindingId} asChild variant={agent.enabled ? "secondary" : "outline"}><Link href={`/dashboard/agents/${agent.id}/connections`}>{agent.name}{agent.enabled ? "" : " (off)"}</Link></Badge>)}</div> : null}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground"><span>Catalog r{connection.catalogRevision} · refreshed {dateLabel(connection.catalogFetchedAt)}</span><span>Last healthy {dateLabel(connection.lastHealthyAt)}</span><span>Last discovery {dateLabel(connection.lastDiscoveredAt)}</span></div>
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  {connection.status === "REAUTH_REQUIRED" || connection.credential.authMode === "OAUTH2_AUTHORIZATION_CODE" ? <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => connection.credential.authMode === "OAUTH2_AUTHORIZATION_CODE" ? void reconnectOAuth(connection) : openManage(connection)}><ExternalLink className="mr-1 size-3.5" />Reconnect</Button> : null}
                  <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => void runConnectionAction(connection, "verify")}>{busyId === connection.id ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 size-3.5" />}Verify</Button>
                  <Button size="sm" variant="outline" disabled={busyId !== null} onClick={() => void runConnectionAction(connection, "discover")}><RefreshCw className="mr-1 size-3.5" />Refresh catalog</Button>
                  <Button size="sm" variant="ghost" disabled={busyId !== null} onClick={() => isGloballyDisabled(connection) ? void setDisabled(connection, false) : setDisableConnection(connection)}>{isGloballyDisabled(connection) ? "Enable globally" : "Disable globally"}</Button>
                  <Button size="sm" variant="ghost" disabled={busyId !== null} className="ml-auto text-destructive" onClick={() => { setDeleteConnection(connection); setDeleteDetach(false); }}><Trash2 className="mr-1 size-3.5" />Delete</Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Add MCP connection</DialogTitle>
            <DialogDescription>
              Step {wizardStep} of {WIZARD_STEPS.length}: {WIZARD_STEPS[wizardStep - 1]}
              {contextAgent ? ` · adding for ${contextAgent.name}` : ""}
            </DialogDescription>
          </DialogHeader>
          <ol className="grid grid-cols-7 gap-1" aria-label="Connection setup progress">
            {WIZARD_STEPS.map((step, index) => (
              <li
                key={step}
                aria-current={wizardStep === index + 1 ? "step" : undefined}
                className={cn(
                  "rounded px-1 py-1.5 text-center text-[10px]",
                  wizardStep === index + 1
                    ? "bg-primary text-primary-foreground"
                    : wizardStep > index + 1
                      ? "bg-emerald-500/15 text-emerald-600"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {step}
              </li>
            ))}
          </ol>

          {wizardStep === 1 ? (
            <div className="space-y-4">
              {wizardProviderGroups.map((group) => <section key={group.label} className="space-y-2" aria-labelledby={`mcp-provider-group-${group.label.replaceAll(" ", "-").toLowerCase()}`}>
                <h3 id={`mcp-provider-group-${group.label.replaceAll(" ", "-").toLowerCase()}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.providers.map((provider) => (
                    <button
                      key={provider.key}
                      type="button"
                      disabled={!provider.connectable}
                      title={provider.unavailableReason ?? undefined}
                      className="rounded-lg border border-border p-3 text-left hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => {
                        selectWizardProvider(provider);
                        setWizardStep(2);
                      }}
                    >
                      <span className="font-medium">{provider.displayName}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{provider.capabilityClasses.map(readable).join(" · ")}</span>
                      <span className="mt-2 block text-xs">{provider.summary}</span>
                      {!provider.connectable ? <span className="mt-2 block text-xs text-amber-500">{provider.unavailableReason}</span> : null}
                    </button>
                  ))}
                </div>
              </section>)}
              {providersQuery.data.customAllowed ? <button
                type="button"
                className="w-full rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  selectWizardProvider(null);
                  setWizardStep(2);
                }}
              >
                <span className="font-medium">Advanced: custom remote server</span>
                <span className="mt-1 block text-xs text-muted-foreground">Custom servers are unreviewed, remote HTTPS only, and receive conservative risk defaults.</span>
              </button> : null}
              <p className="text-xs text-muted-foreground">Local-only and stdio packages are informational only and cannot be connected in the hosted application.</p>
            </div>
          ) : null}

          {wizardStep === 2 ? (
            <div className="space-y-4">
              <label className="block space-y-1 text-xs">
                <span className="text-muted-foreground">Connection name</span>
                <input className={fieldClass} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              {selectedProvider ? (
                <div className="space-y-3 rounded-lg border border-border p-4 text-sm">
                  <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><McpProviderIcon providerKey={selectedProvider.key} displayName={selectedProvider.displayName} brand={selectedProvider.brand} /><span className="font-medium">{selectedProvider.displayName}</span></span><Badge variant="outline">{readable(selectedProvider.riskLevel)} risk</Badge></div>
                  <dl className="grid gap-2 text-xs sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Publisher</dt><dd>{selectedProvider.publisherName}</dd></div>
                    <div><dt className="text-muted-foreground">Endpoint origin</dt><dd className="font-mono">{selectedProvider.endpointOrigins.join(" or ") || "Pending review"}</dd></div>
                    <div><dt className="text-muted-foreground">Authentication</dt><dd>{selectedProvider.authOptions.map(authLabel).join(" or ")}</dd></div>
                    <div><dt className="text-muted-foreground">Chains</dt><dd>{selectedProvider.chainFamilies.join(", ") || "Multi-chain"}</dd></div>
                    <div><dt className="text-muted-foreground">Capabilities</dt><dd>{selectedProvider.capabilityClasses.map(readable).join(", ")}</dd></div>
                    <div><dt className="text-muted-foreground">Effects</dt><dd>{selectedProvider.requiresUserConfirmation ? "State-changing or privileged tools require explicit confirmation." : "Read-oriented baseline; discovered tools are still classified locally."}</dd></div>
                  </dl>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><Link href={selectedProvider.docsUrl} target="_blank" rel="noreferrer">Documentation</Link>{selectedProvider.termsUrl ? <Link href={selectedProvider.termsUrl} target="_blank" rel="noreferrer">Terms</Link> : null}{selectedProvider.privacyUrl ? <Link href={selectedProvider.privacyUrl} target="_blank" rel="noreferrer">Privacy</Link> : null}</div>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="block space-y-1 text-xs"><span className="text-muted-foreground">HTTPS MCP endpoint</span><input type="url" className={fieldClass} value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder="https://mcp.example.com/mcp" /></label>
                  <p className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Only public HTTPS destinations are accepted. Private, loopback, redirect-changing, and unsafe-header targets are rejected. Financial or secret-seeking tools are quarantined or blocked.</p>
                </div>
              )}
            </div>
          ) : null}

          {wizardStep === 3 ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs"><span className="text-muted-foreground">Authentication</span><select className={fieldClass} value={selectedAuth} onChange={(event) => setSelectedAuth(event.target.value as AuthKind)}>{availableAuth.map((auth) => <option key={`${auth.kind}:${auth.headerName ?? ""}`} value={auth.kind}>{authLabel(auth)}</option>)}</select></label>
                <label className="space-y-1 text-xs"><span className="text-muted-foreground">Transport</span><select className={fieldClass} value={transport} onChange={(event) => setTransport(event.target.value as typeof transport)}><option value="STREAMABLE_HTTP">Streamable HTTP</option>{(!selectedProvider || selectedProvider.transports.includes("legacy-sse")) ? <option value="LEGACY_SSE">Legacy SSE</option> : null}</select></label>
              </div>
              {credentialFields(false)}
              {selectedProvider ? <p className="text-xs text-muted-foreground">The server supplies the reviewed endpoint and any fixed header name. Secret values are encrypted and are never returned to this browser.</p> : null}
            </div>
          ) : null}

          {wizardStep === 4 ? (
            <div className="space-y-4">
              <p className="text-sm">AgentRanking will perform a bounded endpoint check, authentication, MCP handshake, and validated tool discovery.</p>
              <div className="grid gap-2 sm:grid-cols-4">
                {["Endpoint", "Authentication", "MCP handshake", "Tool catalog"].map((label) => (
                  <div key={label} className="flex items-center gap-2 rounded-md border border-border p-3 text-xs">
                    {creating ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : completedConnection ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <span className="size-3.5 rounded-full border border-border" />}
                    {label}
                  </div>
                ))}
              </div>
              {completedConnection?.statusMessage ? <p role="status" className="rounded-md bg-muted p-3 text-xs">{completedConnection.statusMessage}</p> : null}
            </div>
          ) : null}

          {wizardStep === 5 ? (
            completedConnection ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{completedConnection.displayName}</h3><Badge variant={statusTone(completedConnection.status)}>{readable(completedConnection.status)}</Badge></div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {Object.entries(completedConnection.toolSummary.counts).filter(([, count]) => count > 0).map(([risk, count]) => <div key={risk} className="rounded-md border border-border p-3 text-xs"><p className="text-muted-foreground">{readable(risk)}</p><p className="mt-1 text-lg font-semibold">{count}</p></div>)}
                </div>
                <p className="text-xs text-muted-foreground">{completedConnection.toolSummary.active} active · {completedConnection.toolSummary.quarantined} quarantined · {completedConnection.toolSummary.removed} removed. Approval defaults can be changed per agent, and hard-blocked risk classes cannot be enabled here.</p>
                {completedConnection.status !== "READY" && completedConnection.status !== "DEGRADED" ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">Verification did not produce an eligible catalog. Correct the connection settings or retry verification before assigning it.</p> : null}
              </div>
            ) : <div className="flex items-center justify-center p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading discovered catalog…</div>
          ) : null}

          {wizardStep === 6 ? (
            <div className="space-y-4">
              <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Enable for agent (optional)</span><select className={fieldClass} value={assignAgentId} onChange={(event) => setAssignAgentId(event.target.value)}><option value="">Do not assign yet</option>{availableAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
              {assignAgentId ? <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Initial approval policy</span><select className={fieldClass} value={initialApprovalMode} onChange={(event) => setInitialApprovalMode(event.target.value as DashboardMcpApprovalMode)}><option value="AUTO_READ_ONLY">Automatically allow read-only tools</option><option value="CONFIRM_MUTATIONS">Confirm mutations</option><option value="CONFIRM_EVERY_CALL">Confirm every call</option><option value="BLOCK_ALL">Block all tools</option></select></label> : null}
              <p className="text-xs text-muted-foreground">Assignment creates one agent-specific binding. The reusable credential and catalog stay account-owned.</p>
            </div>
          ) : null}

          {wizardStep === 7 ? (
            <div className="space-y-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
              <div className="flex items-center gap-2"><CheckCircle2 className="size-5 text-emerald-500" /><h3 className="font-semibold">Connection setup complete</h3></div>
              <p className="text-sm text-muted-foreground">{completedConnection?.displayName} is available at account scope{assignAgentId ? " and assigned to the selected agent" : ""}.</p>
              <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href="/dashboard/connections">View connection details</Link></Button>{assignAgentId && completedConnection ? <Button asChild size="sm"><Link href={`/dashboard/agents/${assignAgentId}/connections`}>Configure agent tools</Link></Button> : null}</div>
            </div>
          ) : null}

          <DialogFooter>
            {wizardStep === 1 ? <Button variant="outline" onClick={() => setWizardOpen(false)}>Cancel</Button> : null}
            {wizardStep > 1 && wizardStep < 4 ? <Button variant="outline" onClick={() => setWizardStep((step) => step - 1)} disabled={creating}>Back</Button> : null}
            {wizardStep === 2 ? <Button onClick={() => setWizardStep(3)} disabled={!displayName.trim() || (!selectedProvider && !endpointUrl.trim())}>Continue</Button> : null}
            {wizardStep === 3 ? <Button onClick={() => setWizardStep(4)}>Review and verify</Button> : null}
            {wizardStep === 4 ? <Button onClick={() => void createConnection()} disabled={creating}>{creating ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}{selectedAuth === "oauth2" ? "Create and authorize" : "Verify and discover"}</Button> : null}
            {wizardStep === 5 ? <Button onClick={() => setWizardStep(6)} disabled={!completedConnection || !["READY", "DEGRADED"].includes(completedConnection.status)}>Continue to assignment</Button> : null}
            {wizardStep === 6 ? <><Button variant="outline" onClick={() => setWizardStep(5)} disabled={creating}>Back</Button><Button onClick={() => void finishAssignment()} disabled={creating}>{creating ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}{assignAgentId ? "Assign and complete" : "Complete"}</Button></> : null}
            {wizardStep === 7 ? <Button onClick={() => setWizardOpen(false)}>Done</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(manageConnection)} onOpenChange={(open) => { if (!open) setManageConnection(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>Manage connection</DialogTitle><DialogDescription>Rotate credentials or change presentation and transport. A credential change expires the catalog until rediscovery.</DialogDescription></DialogHeader>
          {manageConnection ? <div className="space-y-4">{manageConnection.providerManifestMissing ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">This saved provider no longer has an executable reviewed manifest. Runtime use fails closed until platform policy is restored and the catalog is refreshed. Remote and credential settings are locked, but you can rename, disable, or delete the record.</p> : null}<label className="block space-y-1 text-xs"><span className="text-muted-foreground">Display name</span><input className={fieldClass} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-xs"><span className="text-muted-foreground">Authentication</span><select className={fieldClass} disabled={manageConnection.providerManifestMissing} value={selectedAuth} onChange={(event) => setSelectedAuth(event.target.value as AuthKind)}>{(manageConnection.provider?.authOptions ?? availableAuth).map((auth) => <option key={`${auth.kind}:${auth.headerName ?? ""}`} value={auth.kind}>{authLabel(auth)}</option>)}</select></label><label className="space-y-1 text-xs"><span className="text-muted-foreground">Transport</span><select className={fieldClass} disabled={manageConnection.providerManifestMissing} value={transport} onChange={(event) => setTransport(event.target.value as typeof transport)}><option value="STREAMABLE_HTTP">Streamable HTTP</option>{(!manageConnection.provider || manageConnection.provider.transports.includes("legacy-sse")) ? <option value="LEGACY_SSE">Legacy SSE</option> : null}</select></label></div>{manageConnection.providerManifestMissing ? null : credentialFields(true)}<p className="text-[11px] text-muted-foreground">Current credential: {manageConnection.credential.label}{manageConnection.credential.fingerprintSuffix ? ` · …${manageConnection.credential.fingerprintSuffix}` : ""}</p>{manageConnection.recentEvents.length ? <div className="space-y-1.5"><p className="text-xs font-medium">Recent operations</p><div className="max-h-44 divide-y divide-border overflow-y-auto rounded-md border border-border">{manageConnection.recentEvents.slice(0, 8).map((event) => <div key={event.id} className="flex items-start justify-between gap-3 px-2.5 py-2 text-xs"><div><p className="font-medium">{readable(event.action)}</p><p className="text-muted-foreground">{event.reasonCode ? readable(event.reasonCode) : readable(event.status)}</p></div><time className="shrink-0 text-[10px] text-muted-foreground">{dateLabel(event.createdAt)}</time></div>)}</div></div> : null}</div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setManageConnection(null)}>Cancel</Button><Button disabled={!manageConnection || busyId === manageConnection.id} onClick={() => void saveManage()}>{busyId === manageConnection?.id ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(disableConnection)} onOpenChange={(open) => { if (!open) setDisableConnection(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable {disableConnection?.displayName} for every agent?</DialogTitle>
            <DialogDescription>All attached agents immediately lose runtime access. Their assignments and tool policies remain saved and become available again when the connection is globally enabled.</DialogDescription>
          </DialogHeader>
          {disableConnection?.attachedAgents.length ? <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><p className="font-medium">Affected agents</p><ul className="mt-1 list-disc pl-5 text-muted-foreground">{disableConnection.attachedAgents.map((agent) => <li key={agent.bindingId}>{agent.name}</li>)}</ul></div> : <p className="text-sm text-muted-foreground">No agents are currently attached.</p>}
          <DialogFooter><Button variant="outline" onClick={() => setDisableConnection(null)}>Cancel</Button><Button variant="destructive" disabled={!disableConnection} onClick={() => { if (!disableConnection) return; const connection = disableConnection; setDisableConnection(null); void setDisabled(connection, true); }}>Disable globally</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteConnection)} onOpenChange={(open) => { if (!open) setDeleteConnection(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete {deleteConnection?.displayName}?</DialogTitle><DialogDescription>The connection, encrypted credential, catalog, and all agent policies will stop being available. Historical audit records remain redacted.</DialogDescription></DialogHeader>
          {deleteConnection?.attachedAgents.length ? <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium">Affected agents</p><ul className="mt-1 list-disc pl-5 text-muted-foreground">{deleteConnection.attachedAgents.map((agent) => <li key={agent.bindingId}>{agent.name}{agent.enabled ? " (enabled)" : ""}</li>)}</ul><label className="mt-3 flex items-start gap-2 text-xs"><input className="mt-0.5" type="checkbox" checked={deleteDetach} onChange={(event) => setDeleteDetach(event.target.checked)} /><span>Detach all listed agents and delete this connection.</span></label></div> : null}
          <DialogFooter><Button variant="outline" onClick={() => setDeleteConnection(null)}>Cancel</Button><Button variant="destructive" disabled={!deleteConnection || busyId === deleteConnection.id || (deleteConnection.attachedAgents.length > 0 && !deleteDetach)} onClick={() => void confirmDelete()}>{busyId === deleteConnection?.id ? "Deleting…" : "Delete connection"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
