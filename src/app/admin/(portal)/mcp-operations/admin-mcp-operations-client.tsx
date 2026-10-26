"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { adminKeys } from "@/lib/query-keys/admin";

type AdminMcpRule = {
  id: string;
  scope: string;
  value: string;
  action: string;
  active: boolean;
  note: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminMcpAgentReference = {
  bindingId: string;
  enabled: boolean;
  id: number;
  name: string;
  chainId: number;
  agentId: number;
};

type AdminMcpAuditEvent = {
  id: string;
  action: string;
  status: string;
  reasonCode: string | null;
  metadataJson: unknown;
  createdAt: string;
};

type AdminMcpConnection = {
  id: string;
  appAccountId: string;
  accountLabel: string;
  providerKey: string | null;
  displayName: string;
  endpointOrigin: string;
  authMode: string;
  transportMode: string;
  status: string;
  disabledAt: string | null;
  statusReasonCode: string | null;
  statusMessage: string | null;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  catalogRevision: number;
  lastVerifiedAt: string | null;
  lastDiscoveredAt: string | null;
  lastHealthyAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  updatedAt: string;
  agents: AdminMcpAgentReference[];
  audit: AdminMcpAuditEvent[];
};

type AdminMcpInvocation = {
  id: string;
  sourceConnectionId: string | null;
  sourceBindingId: string | null;
  sourceToolName: string | null;
  sourceDisplayName: string | null;
  effectiveRisk: string | null;
  approvalDecision: string | null;
  requestBytes: number | null;
  responseBytes: number | null;
  retryCount: number;
  sanitizedTargetJson: unknown;
  state: string;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
};

type AdminMcpOperations = {
  rules: AdminMcpRule[];
  connections: AdminMcpConnection[];
  invocations: AdminMcpInvocation[];
};

const SCOPES = [
  "GLOBAL",
  "PROVIDER_KEY",
  "ORIGIN",
  "CONNECTION_ID",
  "ACCOUNT_ID",
  "TOOL_PATTERN",
  "RISK_CLASS",
] as const;
const ACTIONS = ["BLOCK_NEW", "BLOCK_RUNTIME", "QUARANTINE"] as const;

function actionsForScope(
  scope: (typeof SCOPES)[number],
): readonly (typeof ACTIONS)[number][] {
  return ["CONNECTION_ID", "TOOL_PATTERN", "RISK_CLASS"].includes(scope)
    ? ACTIONS.filter((action) => action !== "BLOCK_NEW")
    : ACTIONS;
}

function apiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

function relativeDate(value: string | null): string {
  if (!value) return "never";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1_440)}d ago`;
}

async function fetchOperations(signal?: AbortSignal): Promise<AdminMcpOperations> {
  const [policyResponse, connectionResponse] = await Promise.all([
    fetch("/api/admin/mcp/policies", { signal }),
    fetch("/api/admin/mcp/connections", { signal }),
  ]);
  const policyPayload = await policyResponse.json().catch(() => ({}));
  const connectionPayload = await connectionResponse.json().catch(() => ({}));
  if (!policyResponse.ok) throw new Error(apiError(policyPayload, "Could not load MCP policies"));
  if (!connectionResponse.ok) throw new Error(apiError(connectionPayload, "Could not load MCP health"));
  return {
    rules: (policyPayload as { rules?: AdminMcpRule[] }).rules ?? [],
    connections: (connectionPayload as { connections?: AdminMcpConnection[] }).connections ?? [],
    invocations: (connectionPayload as { invocations?: AdminMcpInvocation[] }).invocations ?? [],
  };
}

export function AdminMcpOperationsClient({
  initialData,
}: {
  readonly initialData: AdminMcpOperations;
}) {
  const operations = useQuery({
    queryKey: adminKeys.mcpOperations(),
    queryFn: ({ signal }) => fetchOperations(signal),
    initialData,
    refetchOnMount: false,
  });
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("PROVIDER_KEY");
  const [action, setAction] = useState<(typeof ACTIONS)[number]>("BLOCK_RUNTIME");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = operations.data;
  const availableActions = actionsForScope(scope);

  const filteredConnections = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.connections;
    return data.connections.filter((connection) => [
      connection.id,
      connection.appAccountId,
      connection.accountLabel,
      connection.providerKey,
      connection.displayName,
      connection.endpointOrigin,
      connection.status,
      connection.disabledAt ? "globally disabled" : null,
      ...connection.agents.flatMap((agent) => [agent.name, String(agent.id), String(agent.agentId)]),
    ].filter(Boolean).join(" ").toLowerCase().includes(query));
  }, [data.connections, search]);

  async function createRule(override?: {
    scope: (typeof SCOPES)[number];
    value: string;
    action: (typeof ACTIONS)[number];
    note: string;
  }) {
    const payload = override ?? { scope, value, action, note };
    if (!payload.value.trim()) return;
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/mcp/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiError(result, "Could not save policy"));
      setValue("");
      setNote("");
      setNotice("MCP policy is active.");
      await operations.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save policy");
    } finally {
      setBusy(null);
    }
  }

  async function toggleRule(rule: AdminMcpRule) {
    setBusy(rule.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/mcp/policies/${encodeURIComponent(rule.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !rule.active }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiError(result, "Could not update policy"));
      await operations.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update policy");
    } finally {
      setBusy(null);
    }
  }

  async function connectionAction(connection: AdminMcpConnection, requested: "refresh" | "reauth") {
    setBusy(`${connection.id}:${requested}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/mcp/connections/${encodeURIComponent(connection.id)}/action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: requested }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiError(result, `Could not ${requested} connection`));
      setNotice(requested === "refresh"
        ? `Refreshed ${connection.displayName}.`
        : `${connection.displayName} now requires reauthentication.`);
      await operations.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${requested} connection`);
    } finally {
      setBusy(null);
    }
  }

  const unhealthy = data.connections.filter((connection) =>
    !["READY"].includes(connection.status),
  ).length;
  const activeFinancialBlock = data.rules.some((rule) =>
    rule.active && rule.scope === "RISK_CLASS" && rule.value === "FINANCIAL",
  );

  return (
    <div className="container mx-auto max-w-7xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">MCP operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Incident controls, sanitized health, affected agents, and recent MCP invocation metadata.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-2xl font-semibold">{data.connections.length}</div>
          <div className="text-xs text-muted-foreground">Visible connections</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-2xl font-semibold">{unhealthy}</div>
          <div className="text-xs text-muted-foreground">Need attention</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-2xl font-semibold">{data.rules.filter((rule) => rule.active).length}</div>
          <div className="text-xs text-muted-foreground">Active policies</div>
        </div>
      </div>

      {(error ?? operations.error?.message) && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error ?? operations.error?.message}
        </div>
      )}
      {notice && <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{notice}</div>}

      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="font-semibold">Emergency controls</h2>
          <p className="text-xs text-muted-foreground">
            Rules take effect on the next assignment, catalog resolution, or invocation. They do not delete user data.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={activeFinancialBlock ? "secondary" : "destructive"}
            disabled={busy !== null || activeFinancialBlock}
            onClick={() => void createRule({
              scope: "RISK_CLASS",
              value: "FINANCIAL",
              action: "BLOCK_RUNTIME",
              note: "Emergency independent financial-tool kill switch",
            })}
          >
            <ShieldAlert className="mr-2 h-4 w-4" />
            {activeFinancialBlock ? "Financial tools disabled" : "Disable all financial tools"}
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => void createRule({
              scope: "RISK_CLASS",
              value: "TRANSACTION_PREPARE",
              action: "BLOCK_RUNTIME",
              note: "Emergency transaction-preparation kill switch",
            })}
          >
            Disable transaction preparation
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => void createRule({
              scope: "GLOBAL",
              value: "*",
              action: "BLOCK_NEW",
              note: "Emergency new-connection kill switch",
            })}
          >
            Disable new connections
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() => void createRule({
              scope: "GLOBAL",
              value: "*",
              action: "BLOCK_RUNTIME",
              note: "Emergency global MCP runtime kill switch",
            })}
          >
            Disable all MCP runtime
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(next) => {
              const nextScope = next as typeof scope;
              setScope(nextScope);
              if (!actionsForScope(nextScope).includes(action)) setAction("BLOCK_RUNTIME");
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SCOPES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Action</Label>
            <Select value={action} onValueChange={(next) => setAction(next as typeof action)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{availableActions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Value</Label>
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={scope === "TOOL_PATTERN" ? "provider:tool_* (glob)" : scope === "GLOBAL" ? "*" : "Exact normalized value"}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2 lg:col-span-4">
            <Label>Incident note</Label>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </div>
        </div>
        <Button disabled={busy !== null || !value.trim()} onClick={() => void createRule()}>
          {busy === "create" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Activate policy
        </Button>

        <div className="space-y-2 border-t pt-4">
          {data.rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No administrator policies.</p>
          ) : data.rules.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={rule.active ? "default" : "secondary"}>{rule.active ? "active" : "inactive"}</Badge>
                  <code className="text-xs">{rule.scope} · {rule.action}</code>
                </div>
                <div className="mt-1 break-all text-sm font-medium">{rule.value}</div>
                {rule.note && <div className="text-xs text-muted-foreground">{rule.note}</div>}
                <div className="text-[11px] text-muted-foreground">
                  updated by {rule.updatedBy ?? rule.createdBy ?? "unknown admin"} · {relativeDate(rule.updatedAt)}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void toggleRule(rule)}
              >
                {busy === rule.id ? "Saving…" : rule.active ? "Deactivate" : "Reactivate"}
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Connection health and affected agents</h2>
            <p className="text-xs text-muted-foreground">Up to 100 recently changed or unhealthy connections.</p>
          </div>
          <Input className="max-w-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search account, origin, ID, agent, or status" />
        </div>
        {filteredConnections.length === 0 ? (
          <p className="rounded-md border p-4 text-sm text-muted-foreground">No matching connections.</p>
        ) : filteredConnections.map((connection) => (
          <article key={connection.id} className="space-y-3 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{connection.displayName}</h3>
                  <Badge variant={connection.status === "READY" ? "secondary" : "destructive"}>{connection.status}</Badge>
                  {connection.disabledAt && connection.status !== "DISABLED" ? <Badge variant="outline">GLOBALLY DISABLED</Badge> : null}
                  <Badge variant="outline">{connection.providerKey ?? "custom"}</Badge>
                </div>
                <div className="break-all text-xs text-muted-foreground">{connection.endpointOrigin}</div>
                <div className="text-xs text-muted-foreground">
                  {connection.accountLabel} · account <code>{connection.appAccountId}</code> · connection <code>{connection.id}</code>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void connectionAction(connection, "refresh")}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  {busy === `${connection.id}:refresh` ? "Refreshing…" : "Force refresh"}
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void connectionAction(connection, "reauth")}>
                  {busy === `${connection.id}:reauth` ? "Updating…" : "Require reauth"}
                </Button>
              </div>
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><span className="text-muted-foreground">Catalog</span><br />revision {connection.catalogRevision} · {connection.protocolVersion ?? "unknown protocol"}</div>
              <div><span className="text-muted-foreground">Last healthy</span><br />{relativeDate(connection.lastHealthyAt)}</div>
              <div><span className="text-muted-foreground">Last discovery</span><br />{relativeDate(connection.lastDiscoveredAt)}</div>
              <div><span className="text-muted-foreground">Failures</span><br />{connection.consecutiveFailures}{connection.circuitOpenUntil ? ` · circuit until ${relativeDate(connection.circuitOpenUntil)}` : ""}</div>
            </div>
            {(connection.statusMessage || connection.lastErrorCode) && (
              <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{connection.lastErrorCode ?? connection.statusReasonCode}: {connection.statusMessage ?? "See recent audit metadata."}</span>
              </div>
            )}
            <div>
              <div className="text-xs font-medium">Affected agents ({connection.agents.length})</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {connection.agents.length === 0 ? <span className="text-xs text-muted-foreground">None</span> : connection.agents.map((agent) => (
                  <Badge key={agent.bindingId} variant={agent.enabled ? "secondary" : "outline"}>
                    {agent.name} · db {agent.id} · {agent.chainId}:{agent.agentId} · {agent.enabled ? "enabled" : "disabled"}
                  </Badge>
                ))}
              </div>
            </div>
            {connection.audit[0] && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Recent sanitized audit ({connection.audit.length})</summary>
                <div className="mt-2 space-y-2">
                  {connection.audit.map((event) => (
                    <div key={event.id} className="rounded border p-2">
                      <div>{event.action} · {event.status} · {relativeDate(event.createdAt)} {event.reasonCode ? `· ${event.reasonCode}` : ""}</div>
                      {event.metadataJson != null && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10px] text-muted-foreground">{JSON.stringify(event.metadataJson, null, 2)}</pre>}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </article>
        ))}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Recent sanitized invocations</h2>
          <p className="text-xs text-muted-foreground">Payload bodies and credentials are not included.</p>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr><th className="p-2">When</th><th className="p-2">Connection / tool</th><th className="p-2">Risk / approval</th><th className="p-2">Outcome</th><th className="p-2">Bytes</th><th className="p-2">Target</th></tr>
            </thead>
            <tbody>
              {data.invocations.map((event) => (
                <tr key={event.id} className="border-t align-top">
                  <td className="p-2">{relativeDate(event.startedAt)}</td>
                  <td className="p-2"><div>{event.sourceDisplayName ?? event.sourceConnectionId}</div><code>{event.sourceToolName ?? "unknown"}</code></td>
                  <td className="p-2">{event.effectiveRisk ?? "unknown"}<br />{event.approvalDecision ?? "not recorded"}</td>
                  <td className="p-2">{event.state}<br />{event.durationMs == null ? "—" : `${event.durationMs} ms`} · retries {event.retryCount}</td>
                  <td className="p-2">{event.requestBytes ?? "—"} / {event.responseBytes ?? "—"}</td>
                  <td className="max-w-xs p-2"><code className="break-all">{event.sanitizedTargetJson == null ? "—" : JSON.stringify(event.sanitizedTargetJson)}</code></td>
                </tr>
              ))}
              {data.invocations.length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={6}>No MCP invocations recorded.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
