"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { McpProviderIcon, mcpProviderAuthLabel } from "@/components/dashboard/mcp-reviewed-providers";
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
import type {
  DashboardAgentMcpItem,
  DashboardMcpApprovalMode,
  DashboardMcpConnection,
  DashboardMcpProvider,
  DashboardMcpProviderAuth,
} from "@/features/agent-chat/shared/mcp-dashboard-types";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import { cn } from "@/lib/utils";

type AuthKind = DashboardMcpProviderAuth["kind"];

export type AgentMcpConnectionCreatorRequest =
  | { id: string; kind: "provider"; provider: DashboardMcpProvider }
  | { id: string; kind: "custom" }
  | { id: string; kind: "resume"; connection: DashboardMcpConnection };

type Props = {
  agentDbId: number;
  agentName: string;
  request: AgentMcpConnectionCreatorRequest;
  onClose: () => void;
};

const fieldClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring";
const STEPS = ["Access", "Authenticate", "Verify", "Tools", "Enable", "Complete"] as const;

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

function statusTone(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "READY") return "default";
  if (["DEGRADED", "AUTH_PENDING", "REAUTH_REQUIRED"].includes(status)) return "secondary";
  if (["INVALID", "BLOCKED", "DELETED"].includes(status)) return "destructive";
  return "outline";
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

export function AgentMcpConnectionCreator({ agentDbId, agentName, request, onClose }: Props) {
  const queryClient = useQueryClient();
  const resumedConnection = request.kind === "resume" ? request.connection : null;
  const selectedProvider = request.kind === "provider"
    ? request.provider
    : resumedConnection?.provider ?? null;
  const [step, setStep] = useState(resumedConnection ? 4 : 1);
  const [displayName, setDisplayName] = useState(
    resumedConnection?.displayName ?? selectedProvider?.displayName ?? "",
  );
  const [endpointUrl, setEndpointUrl] = useState("");
  const [selectedAuth, setSelectedAuth] = useState<AuthKind>(
    resumedConnection ? connectionAuthKind(resumedConnection) : selectedProvider?.auth.kind ?? "none",
  );
  const [transport, setTransport] = useState<"STREAMABLE_HTTP" | "LEGACY_SSE">(
    resumedConnection?.transport
      ?? (selectedProvider?.transports[0] === "legacy-sse" ? "LEGACY_SSE" : "STREAMABLE_HTTP"),
  );
  const [secret, setSecret] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tokenEndpoint, setTokenEndpoint] = useState("");
  const [scope, setScope] = useState("");
  const [expectedIssuer, setExpectedIssuer] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [approvalMode, setApprovalMode] = useState<DashboardMcpApprovalMode>(
    selectedProvider?.defaultBindingPolicy.approvalMode
      ?? resumedConnection?.provider?.defaultBindingPolicy.approvalMode
      ?? "CONFIRM_EVERY_CALL",
  );
  const [completedConnection, setCompletedConnection] = useState<DashboardMcpConnection | null>(
    resumedConnection,
  );
  const [creating, setCreating] = useState(false);

  const availableAuth = selectedProvider?.authOptions ?? [
    { kind: "none" as const },
    { kind: "bearer" as const },
    { kind: "api-key-header" as const },
    { kind: "oauth2" as const },
    { kind: "client-credentials" as const },
  ];

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

  async function startOAuth(connectionId: string) {
    const response = await fetch(`/api/dashboard/mcp/connections/${encodeURIComponent(connectionId)}/oauth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnAgentDbId: agentDbId }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(apiMessage(body, "Could not start OAuth"));
    if (body.authorizationUrl) {
      window.location.assign(body.authorizationUrl as string);
      return true;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: dashboardKeys.mcpConnections() }),
      queryClient.refetchQueries({ queryKey: dashboardKeys.agentMcpBindings(agentDbId) }),
    ]);
    const refreshedConnection = queryClient
      .getQueryData<DashboardAgentMcpItem[]>(dashboardKeys.agentMcpBindings(agentDbId))
      ?.find((item) => item.connection.id === connectionId)?.connection;
    if (refreshedConnection) setCompletedConnection(refreshedConnection);
    showToast("OAuth credentials are already connected", "success");
    return false;
  }

  async function createConnection() {
    if (!displayName.trim()) {
      showToast("Enter a connection name", "error");
      return;
    }
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
          providerKey: selectedProvider?.key ?? null,
          displayName: displayName.trim(),
          ...(selectedProvider ? {} : { endpointUrl: endpointUrl.trim() }),
          credential: credentialPayload(),
          transportMode: transport,
          idempotencyKey,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not create MCP connection"));
      const connection = body.connection as DashboardMcpConnection;
      setSecret("");
      setClientSecret("");
      setTokenEndpoint("");
      setCompletedConnection(connection);
      queryClient.setQueryData<DashboardMcpConnection[]>(dashboardKeys.mcpConnections(), (current = []) => [
        connection,
        ...current.filter((item) => item.id !== connection.id),
      ]);
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.agentMcpBindings(agentDbId) });

      if (selectedAuth === "oauth2") {
        const redirecting = await startOAuth(connection.id);
        if (!redirecting) setStep(4);
      } else {
        setStep(4);
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

  async function enableForAgent() {
    if (!completedConnection) return;
    setCreating(true);
    try {
      const response = await fetch(
        `/api/dashboard/agents/${agentDbId}/mcp-bindings/${encodeURIComponent(completedConnection.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true, approvalMode }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "Could not enable connection for agent"));
      const updatedItem = body.item as DashboardAgentMcpItem;
      queryClient.setQueryData<DashboardAgentMcpItem[]>(
        dashboardKeys.agentMcpBindings(agentDbId),
        (current = []) => [
          updatedItem,
          ...current.filter((item) => item.connection.id !== updatedItem.connection.id),
        ],
      );
      queryClient.setQueryData<DashboardMcpConnection[]>(
        dashboardKeys.mcpConnections(),
        (current) => current?.map((connection) => connection.id === updatedItem.connection.id
          ? {
              ...connection,
              ...updatedItem.connection,
              attachedAgents: [
                ...connection.attachedAgents.filter((agent) => agent.id !== agentDbId),
                {
                  id: agentDbId,
                  name: agentName,
                  image: "",
                  bindingId: updatedItem.binding?.id ?? `binding:${agentDbId}`,
                  enabled: true,
                },
              ],
            }
          : connection),
      );
      setCompletedConnection(updatedItem.connection);
      setStep(6);
      showToast(`${updatedItem.connection.displayName} enabled for ${agentName}`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not enable connection for agent", "error");
    } finally {
      setCreating(false);
    }
  }

  function credentialFields() {
    return (
      <div className="space-y-3">
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
            <span className="block text-[11px] text-muted-foreground">Injected only at the reviewed provider boundary; it is excluded from stored endpoints and model-visible tool input.</span>
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
      </div>
    );
  }

  const canUseCatalog = completedConnection
    && ["READY", "DEGRADED"].includes(completedConnection.status);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{resumedConnection ? "Finish MCP connection" : `Connect ${selectedProvider?.displayName ?? "custom MCP server"}`}</DialogTitle>
          <DialogDescription>
            Step {step} of {STEPS.length}: {STEPS[step - 1]} · this connection will be enabled for {agentName}.
          </DialogDescription>
        </DialogHeader>

        <ol className="grid grid-cols-6 gap-1" aria-label="Connection setup progress">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={step === index + 1 ? "step" : undefined}
              className={cn(
                "rounded px-1 py-1.5 text-center text-[10px]",
                step === index + 1
                  ? "bg-primary text-primary-foreground"
                  : step > index + 1
                    ? "bg-emerald-500/15 text-emerald-600"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {label}
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <div className="space-y-4">
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">Connection name</span>
              <input className={fieldClass} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            {selectedProvider ? (
              <div className="space-y-3 rounded-lg border border-border p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <McpProviderIcon providerKey={selectedProvider.key} displayName={selectedProvider.displayName} brand={selectedProvider.brand} />
                    <div><p className="font-medium">{selectedProvider.displayName}</p><p className="text-xs text-muted-foreground">by {selectedProvider.publisherName}</p></div>
                  </div>
                  <Badge variant="outline">{readable(selectedProvider.riskLevel)} risk</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{selectedProvider.summary}</p>
                <dl className="grid gap-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Endpoint origin</dt><dd className="font-mono">{selectedProvider.endpointOrigins.join(" or ") || "Pending review"}</dd></div>
                  <div><dt className="text-muted-foreground">Authentication</dt><dd>{selectedProvider.authOptions.map(mcpProviderAuthLabel).join(" or ")}</dd></div>
                  <div><dt className="text-muted-foreground">Chains</dt><dd>{selectedProvider.chainFamilies.join(", ") || "Multi-chain"}</dd></div>
                  <div><dt className="text-muted-foreground">Capabilities</dt><dd>{selectedProvider.capabilityClasses.map(readable).join(", ")}</dd></div>
                </dl>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <Link className="inline-flex items-center gap-1 hover:text-foreground" href={selectedProvider.docsUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-3" />Documentation</Link>
                  {selectedProvider.termsUrl ? <Link className="hover:text-foreground" href={selectedProvider.termsUrl} target="_blank" rel="noreferrer">Terms</Link> : null}
                  {selectedProvider.privacyUrl ? <Link className="hover:text-foreground" href={selectedProvider.privacyUrl} target="_blank" rel="noreferrer">Privacy</Link> : null}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block space-y-1 text-xs"><span className="text-muted-foreground">HTTPS MCP endpoint</span><input type="url" className={fieldClass} value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder="https://mcp.example.com/mcp" /></label>
                <p className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Custom servers are unreviewed. Only public HTTPS destinations are accepted; private, loopback, redirect-changing, and unsafe-header targets are rejected.</p>
              </div>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs"><span className="text-muted-foreground">Authentication</span><select className={fieldClass} value={selectedAuth} onChange={(event) => setSelectedAuth(event.target.value as AuthKind)}>{availableAuth.map((auth) => <option key={`${auth.kind}:${auth.headerName ?? ""}`} value={auth.kind}>{mcpProviderAuthLabel(auth)}</option>)}</select></label>
              <label className="space-y-1 text-xs"><span className="text-muted-foreground">Transport</span><select className={fieldClass} value={transport} onChange={(event) => setTransport(event.target.value as typeof transport)}><option value="STREAMABLE_HTTP">Streamable HTTP</option>{(!selectedProvider || selectedProvider.transports.includes("legacy-sse")) ? <option value="LEGACY_SSE">Legacy SSE</option> : null}</select></label>
            </div>
            {credentialFields()}
            {selectedProvider ? <p className="text-xs text-muted-foreground">The reviewed manifest supplies the endpoint and any fixed header name. Secret values are encrypted and are never returned to this browser.</p> : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <p className="text-sm">AgentRanking will create the account-owned credential, perform a bounded endpoint check, authenticate, complete the MCP handshake, and validate the discovered tool catalog.</p>
            <div className="grid gap-2 sm:grid-cols-4">
              {["Endpoint", "Authentication", "MCP handshake", "Tool catalog"].map((label) => (
                <div key={label} className="flex items-center gap-2 rounded-md border border-border p-3 text-xs">
                  {creating ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : <span className="size-3.5 rounded-full border border-border" />}
                  {label}
                </div>
              ))}
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <p><span className="font-medium text-foreground">Connection:</span> {displayName || "Unnamed"}</p>
              <p><span className="font-medium text-foreground">Provider:</span> {selectedProvider?.displayName ?? "Custom remote server"}</p>
              <p><span className="font-medium text-foreground">Authentication:</span> {mcpProviderAuthLabel(availableAuth.find((auth) => auth.kind === selectedAuth) ?? { kind: selectedAuth })}</p>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          completedConnection ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <McpProviderIcon providerKey={completedConnection.providerKey} displayName={completedConnection.provider?.displayName ?? completedConnection.displayName} brand={completedConnection.provider?.brand} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{completedConnection.displayName}</h3><Badge variant={statusTone(completedConnection.status)}>{readable(completedConnection.status)}</Badge></div>
                  <p className="mt-1 text-xs text-muted-foreground">{completedConnection.statusMessage ?? "Tool discovery completed."}</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {Object.entries(completedConnection.toolSummary.counts).filter(([, count]) => count > 0).map(([risk, count]) => <div key={risk} className="rounded-md border border-border p-3 text-xs"><p className="text-muted-foreground">{readable(risk)}</p><p className="mt-1 text-lg font-semibold">{count}</p></div>)}
              </div>
              <p className="text-xs text-muted-foreground">{completedConnection.toolSummary.active} active · {completedConnection.toolSummary.quarantined} quarantined · {completedConnection.toolSummary.removed} removed. Approval policy is applied specifically to {agentName}; hard-blocked risk classes remain unavailable.</p>
              {!canUseCatalog ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">Verification did not produce an eligible catalog. This connection cannot be enabled for the agent until its account connection is corrected.</p> : null}
            </div>
          ) : <div className="flex items-center justify-center p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Loading discovered catalog…</div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium">Enable for {agentName}</p>
              <p className="mt-1 text-xs text-muted-foreground">The credential remains account-owned. Only this agent receives an assignment and its own approval/tool policy.</p>
            </div>
            <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Initial approval policy</span><select className={fieldClass} value={approvalMode} onChange={(event) => setApprovalMode(event.target.value as DashboardMcpApprovalMode)}><option value="AUTO_READ_ONLY">Automatically allow read-only tools</option><option value="CONFIRM_MUTATIONS">Confirm mutations</option><option value="CONFIRM_EVERY_CALL">Confirm every call</option><option value="BLOCK_ALL">Block all tools</option></select></label>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="space-y-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
            <div className="flex items-center gap-2"><CheckCircle2 className="size-5 text-emerald-500" /><h3 className="font-semibold">Connection enabled</h3></div>
            <p className="text-sm text-muted-foreground">{completedConnection?.displayName} is connected at account scope and enabled for {agentName}. You can configure per-tool policy directly from the connection list below.</p>
          </div>
        ) : null}

        <DialogFooter>
          {step === 1 ? <Button variant="outline" onClick={onClose}>Cancel</Button> : null}
          {step === 2 ? <><Button variant="outline" onClick={() => setStep(1)} disabled={creating}>Back</Button><Button onClick={() => setStep(3)}>Review and verify</Button></> : null}
          {step === 1 ? <Button onClick={() => setStep(2)} disabled={!displayName.trim() || (!selectedProvider && !endpointUrl.trim())}>Continue</Button> : null}
          {step === 3 ? <><Button variant="outline" onClick={() => setStep(2)} disabled={creating}>Back</Button><Button onClick={() => void createConnection()} disabled={creating}>{creating ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}{selectedAuth === "oauth2" ? "Create and authorize" : "Verify and discover"}</Button></> : null}
          {step === 4 ? <Button onClick={() => setStep(5)} disabled={!canUseCatalog}>Continue to enable</Button> : null}
          {step === 5 ? <><Button variant="outline" onClick={() => setStep(4)} disabled={creating}>Back</Button><Button onClick={() => void enableForAgent()} disabled={creating || !completedConnection}>{creating ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}Enable for {agentName}</Button></> : null}
          {step === 6 ? <Button onClick={onClose}>Done</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
