"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
type MetaplexBulkQueueResponse = {
  ok: boolean;
  accepted: boolean;
  total: number;
  queued: number;
  deduplicated: number;
  results: Array<{ assetAddress: string; jobId: string | null }>;
};
type Props = {
  readonly id?: string;
};
export function MetaplexBulkIndexForm({ id }: Props) {
  const [addressesText, setAddressesText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MetaplexBulkQueueResponse | null>(null);
  async function handleSubmit() {
    const assetAddresses = addressesText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (assetAddresses.length === 0) {
      setError("Paste at least one Core asset address.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/metaplex/bulk-index", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetAddresses }),
      });
      const data = (await res.json()) as MetaplexBulkQueueResponse & { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Bulk index failed (${res.status})`);
        return;
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk index failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div id={id} className="rounded-lg border border-violet-500/25 bg-violet-950/10 p-4 space-y-3 scroll-mt-20">
      <p className="text-sm font-medium">Bulk Index Metaplex Agents</p>
      <p className="text-xs text-muted-foreground">
        Paste Core asset addresses, one per line. Each asset becomes a durable pg-boss job with bounded worker concurrency.
      </p>
      <Textarea
        value={addressesText}
        onChange={(e) => setAddressesText(e.target.value)}
        placeholder="Core asset address (base58)&#10;Core asset address (base58)"
        rows={6}
        disabled={loading}
        className="font-mono text-xs"
      />
      <Button type="button" onClick={() => void handleSubmit()} disabled={loading || !addressesText.trim()}>
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "Index Agents"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {result ? (
        <div className="rounded-md border border-border/60 bg-muted/10 p-3 text-xs space-y-2">
          <p>
            Total {result.total} · Queued {result.queued} · Already queued {result.deduplicated}
          </p>
          <div className="max-h-48 overflow-auto space-y-1 font-mono text-[11px]">
            {result.results.map((row) => (
              <div key={row.assetAddress} className="break-all">
                <span className={row.jobId ? "text-emerald-400" : "text-muted-foreground"}>
                  {row.jobId ? "QUEUED" : "DEDUPED"} {row.assetAddress}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}