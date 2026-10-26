"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, EyeOff, KeyRound, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast-simple";
import { dashboardKeys } from "@/lib/query-keys/dashboard";
import type {
  LlmProviderCredentialStatus,
  LlmProviderCredentialsResponse,
  LlmProviderDescriptor,
} from "@/lib/llm-provider/credential-contracts";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function stateLabel(status: LlmProviderCredentialStatus | undefined): string {
  switch (status?.state) {
    case "valid":
      return "Connected";
    case "invalid":
      return "Invalid";
    case "temporarily_unavailable":
      return "Provider unavailable";
    case "revoked":
      return "Revoked";
    default:
      return "Not connected";
  }
}

function ProviderCredentialRow({
  provider,
  status,
  onChanged,
}: {
  provider: LlmProviderDescriptor;
  status: LlmProviderCredentialStatus | undefined;
  onChanged: () => Promise<void>;
}) {
  const [credentialSecret, setCredentialSecret] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const connected = status?.state === "valid";
  const canRevoke = status != null
    && status.state !== "disconnected"
    && status.state !== "revoked";

  const save = useCallback(async () => {
    const value = credentialSecret.trim();
    if (!value) return;
    setSaving(true);
    try {
      const response = await fetch("/api/dashboard/settings/llm-provider-credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id, secret: value }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not validate provider key");
      setCredentialSecret("");
      setShowKey(false);
      await onChanged();
      showToast(`${provider.label} key connected`, "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not connect provider key",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }, [credentialSecret, onChanged, provider.id, provider.label]);

  const revoke = useCallback(async () => {
    setRevoking(true);
    try {
      const response = await fetch("/api/dashboard/settings/llm-provider-credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not revoke provider key");
      setCredentialSecret("");
      await onChanged();
      showToast(`${provider.label} key revoked`, "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Could not revoke provider key",
        "error",
      );
    } finally {
      setRevoking(false);
    }
  }, [onChanged, provider.id, provider.label]);

  return (
    <div className="rounded-lg border border-border/70 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{provider.label}</p>
            {connected ? <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{provider.description}</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{stateLabel(status)}</span>
      </div>

      {status?.fingerprint ? (
        <div className="grid gap-1 text-xs sm:grid-cols-2">
          <span className="text-muted-foreground">Key</span>
          <span className="font-mono sm:text-right">{status.fingerprint}</span>
          <span className="text-muted-foreground">Validated</span>
          <span className="sm:text-right">{formatDate(status.validatedAt)}</span>
          {status.modelCount != null ? (
            <>
              <span className="text-muted-foreground">Chat models</span>
              <span className="sm:text-right">{status.modelCount}</span>
            </>
          ) : null}
          {status.lastUsedAt ? (
            <>
              <span className="text-muted-foreground">Last used</span>
              <span className="sm:text-right">{formatDate(status.lastUsedAt)}</span>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Input
            type={showKey ? "text" : "password"}
            value={credentialSecret}
            onChange={(event) => setCredentialSecret(event.target.value)}
            placeholder={connected ? `Replace ${provider.credentialLabel}` : provider.credentialLabel}
            autoComplete="off"
            spellCheck={false}
            className="pr-9 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey((value) => !value)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showKey ? "Hide provider credential" : "Show provider credential"}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <Button size="sm" onClick={save} disabled={saving || !credentialSecret.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : connected ? <RotateCcw className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
          {connected ? "Replace" : "Connect"}
        </Button>
        {canRevoke ? (
          <Button size="sm" variant="outline" onClick={revoke} disabled={revoking || saving}>
            {revoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Revoke
          </Button>
        ) : null}
      </div>

      {provider.helpUrl ? (
        <a
          href={provider.helpUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Create or manage a provider key
        </a>
      ) : null}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The key is checked server-side, encrypted before database storage, and never returned by this page. Catalog permission, quota, or provider outages do not invalidate the credential; provider quota and billing rules still apply.
      </p>
    </div>
  );
}

export function LlmProviderCredentialsCard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: dashboardKeys.llmProviderCredentials(),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/dashboard/settings/llm-provider-credentials", {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json().catch(() => ({}))) as LlmProviderCredentialsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load provider credentials");
      return payload;
    },
    staleTime: 30_000,
  });
  const data = query.data ?? null;
  const loading = query.isPending;
  const error = query.isError
    ? (query.error?.message ?? "Could not load provider credentials")
    : null;
  const reload = () =>
    queryClient.invalidateQueries({
      queryKey: dashboardKeys.llmProviderCredentials(),
    });

  const statusByProvider = useMemo(
    () => new Map((data?.credentials ?? []).map((item) => [item.provider, item] as const)),
    [data?.credentials],
  );

  return (
    <div className="ui-panel space-y-3 p-4">
      <div>
        <p className="text-sm font-medium">LLM provider keys</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Bring your own provider keys to add account-specific models without consuming AgentRanking LLM credits. Each provider has an independent credential slot, so you can connect every supported provider at the same time.
        </p>
        {data ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {data.connectedProviderCount} of {data.providers.length} providers connected.
          </p>
        ) : null}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading provider keys…
        </div>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-xs text-destructive">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : data?.providers.length ? (
        <div className="space-y-3">
          {data.providers.map((provider) => (
            <ProviderCredentialRow
              key={provider.id}
              provider={provider}
              status={statusByProvider.get(provider.id)}
              onChanged={reload}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No BYOK providers are enabled on this deployment.</p>
      )}
    </div>
  );
}
