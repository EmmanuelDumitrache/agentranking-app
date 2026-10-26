"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminKeys } from "@/lib/query-keys/admin";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
const MATCH_TYPES = [
  "name_contains",
  "name_exact",
  "uri_contains",
  "uri_exact",
  "owner_wallet",
  "agent_key",
] as const;
export type AdminAgentBlocklistRule = {
  id: string;
  matchType: string;
  value: string;
  active: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
};
export function AdminAgentBlocklistClient({ initialRules }: { readonly initialRules: AdminAgentBlocklistRule[] }) {
  const rulesQuery = useQuery({
    queryKey: adminKeys.agentBlocklist(),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/admin/agent-blocklist", { signal });
      const payload = (await response.json()) as { rules?: AdminAgentBlocklistRule[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load");
      return payload.rules ?? [];
    },
    initialData: initialRules,
    refetchOnMount: false,
  });
  const rules = rulesQuery.data ?? [];
  const { isPending: loading, error: loadError, refetch } = rulesQuery;
  const refresh = () => void refetch();
  const [error, setError] = useState<string | null>(null);
  const visibleError = error ?? loadError?.message ?? null;
  const [notice, setNotice] = useState<string | null>(null);
  const [matchType, setMatchType] = useState<(typeof MATCH_TYPES)[number]>("name_contains");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState("");
  async function createRule() {
    if (!value.trim()) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/agent-blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchType, value: value.trim(), note: note.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Create failed");
        return;
      }
      setValue("");
      setNote("");
      refresh();
    } finally {
      setCreating(false);
    }
  }
  async function toggleActive(rule: AdminAgentBlocklistRule) {
    const res = await fetch(`/api/admin/agent-blocklist/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !rule.active }),
    });
    if (res.ok) refresh();
  }
  async function runPreview() {
    if (!value.trim()) return;
    setPreviewLoading(true);
    setPreviewCount(null);
    try {
      const res = await fetch("/api/admin/agent-blocklist/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchType, value: value.trim() }),
      });
      const json = (await res.json()) as { count?: number; error?: string };
      setPreviewCount(typeof json.count === "number" ? json.count : 0);
      if (json.error) setError(json.error);
    } catch {
      setPreviewCount(null);
      setError("Preview request failed");
    } finally {
      setPreviewLoading(false);
    }
  }
  async function runPurge() {
    if (!value.trim()) return;
    if (confirmPurge !== "DELETE_MATCHING_AGENTS") {
      setError('Type DELETE_MATCHING_AGENTS in the confirmation box to purge.');
      return;
    }
    setPurgeBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/agent-blocklist/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchType,
          value: value.trim(),
          confirm: "DELETE_MATCHING_AGENTS",
        }),
      });
      const json = (await res.json()) as { deleted?: number; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Purge failed");
        return;
      }
      setConfirmPurge("");
      setPreviewCount(null);
      refresh();
      setNotice(`Deleted ${json.deleted ?? 0} agent row(s). Related data followed Prisma cascade rules.`);
    } finally {
      setPurgeBusy(false);
    }
  }
  return (
    <div className="container max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Agent blocklist</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Hide listings from public APIs and reject new ingests that match. Purge permanently deletes matching{" "}
        <code className="text-xs">Agent</code> rows (destructive).
      </p>
      <div className="rounded-lg border border-border bg-card p-4 mb-8 space-y-3">
        <h2 className="text-sm font-semibold">New rule</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Match type</Label>
            <Select value={matchType} onValueChange={(v: string) => setMatchType(v as (typeof MATCH_TYPES)[number])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MATCH_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Value</Label>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Substring, exact name, URI, 0x owner, or chainId:agentId" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Note (admin)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this rule exists" rows={2} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" onClick={() => void createRule()} disabled={creating || !value.trim()}>
            {creating ? "Saving…" : "Save rule"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void runPreview()} disabled={previewLoading || !value.trim()}>
            {previewLoading ? "Counting…" : "Preview match count"}
          </Button>
        </div>
        {previewCount !== null && (
          <p className="text-sm text-muted-foreground">
            Matching agents: <span className="font-mono text-foreground">{previewCount}</span>
          </p>
        )}
        <div className="border-t border-border pt-3 space-y-2">
          <Label className="text-amber-600">Hard purge (delete matching agents)</Label>
          <Input
            value={confirmPurge}
            onChange={(e) => setConfirmPurge(e.target.value)}
            placeholder='Type DELETE_MATCHING_AGENTS to confirm'
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="gap-1"
            disabled={purgeBusy || !value.trim()}
            onClick={() => void runPurge()}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {purgeBusy ? "Purging…" : "Purge matching agents"}
          </Button>
        </div>
      </div>
      {visibleError && <p className="text-sm text-red-400 mb-2">{visibleError}</p>}
      {notice && <p className="text-sm text-green-500 mb-4">{notice}</p>}
      <h2 className="text-sm font-semibold mb-2">Active rules</h2>
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rules.length === 0 ? (
        <p className="text-muted-foreground">No rules yet.</p>
      ) : (
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.id} className="rounded-md border border-border px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-mono text-muted-foreground">{r.matchType}</span>
                <div className="text-sm font-medium break-all">{r.value}</div>
                {r.note ? <div className="text-xs text-muted-foreground mt-0.5">{r.note}</div> : null}
              </div>
              <Button size="sm" variant={r.active ? "secondary" : "outline"} onClick={() => void toggleActive(r)}>
                {r.active ? "Deactivate" : "Activate"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
