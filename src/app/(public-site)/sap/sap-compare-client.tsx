"use client";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SapVerifiedBadge, oobeExplorerAccountUrl } from "@/components/agents/sap-verified-badge";
import type { SapAgentPublicDto, SapComparePayload } from "@/lib/sap-ecosystem-shared";
import {
  capabilityKey,
  normalizeSapComparePda,
  sapCompareResourceKey,
  type X402Status,
} from "@/lib/sap-ecosystem-shared";
import { ExternalLink, Loader2 } from "lucide-react";
import { publicKeys } from "@/lib/query-keys/public";
function capSet(agent: SapAgentPublicDto): Set<string> {
  return new Set(agent.capabilities.map((c) => capabilityKey(c)));
}
function X402Pill({ status }: { readonly status: X402Status }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "live" && "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
        status === "offline" && "border-amber-500/50 bg-amber-500/10 text-amber-200",
        status === "unknown" && "border-border text-muted-foreground"
      )}
    >
      x402 {status}
    </Badge>
  );
}
type SapCompareClientProps = {
  readonly initialA: string;
  readonly initialB: string;
  readonly initialData?: SapComparePayload | null;
  readonly initialDataKey: string | null;
  readonly initialError: string | null;
};
export function SapCompareClient({
  initialA,
  initialB,
  initialData,
  initialDataKey,
  initialError,
}: SapCompareClientProps) {
  const router = useRouter();
  const sp = useSearchParams();
  const bFromUrl = normalizeSapComparePda(initialB || sp.get("b"));
  const [bInput, setBInput] = useState(bFromUrl);
  const a = normalizeSapComparePda(initialA || sp.get("a"));
  const b = bFromUrl;
  const resourceKey = sapCompareResourceKey(a, b);
  const compareQuery = useQuery({
    queryKey: publicKeys.sapCompare(a, b),
    queryFn: async ({ signal }): Promise<SapComparePayload | null> => {
      if (!resourceKey) return null;
      const response = await fetch(
        `/api/sap/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
        { signal },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || response.statusText);
      }
      return (await response.json()) as SapComparePayload;
    },
    initialData: resourceKey === initialDataKey ? initialData : undefined,
    refetchOnMount: false,
  });
  const data = compareQuery.data;
  const loading = compareQuery.isPending;
  const error = compareQuery.error;
  const effectiveError = error?.message ?? (resourceKey === initialDataKey ? initialError : null);
  const applyCompare = () => {
    if (!a || !bInput.trim()) return;
    router.push(`/sap/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(bInput.trim())}`);
  };
  if (!a) {
    return (
      <Card className="border-border">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Open this page with <code className="text-xs">?a=…</code> (SAP agent PDA) from an agent profile, or start
          from{" "}
          <Link href="/agents?sapVerified=true" className="text-emerald-400 hover:underline">
            SAP agents
          </Link>
          .
        </CardContent>
      </Card>
    );
  }
  if (!b) {
    return (
      <div className="space-y-6">
        <Card className="border-emerald-500/25 bg-emerald-500/[0.04]">
          <CardHeader>
            <CardTitle className="text-base">Pick second agent</CardTitle>
            <p className="text-xs text-muted-foreground">
              Agent A is set. Paste another SAP agent PDA to compare side by side.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label htmlFor="sap-compare-b" className="text-[11px] text-muted-foreground">
                SAP agent PDA (B)
              </label>
              <Input
                id="sap-compare-b"
                value={bInput}
                onChange={(event) => setBInput(event.target.value)}
                placeholder="Paste PDA…"
                className="font-mono text-xs bg-background"
              />
            </div>
            <Button type="button" onClick={applyCompare} className="shrink-0 bg-emerald-600 hover:bg-emerald-500">
              Compare
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/agents?sapVerified=true">Browse directory</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading comparison…
      </div>
    );
  }
  if (effectiveError && !data) {
    return <p className="text-sm text-destructive">{effectiveError}</p>;
  }
  if (!data) {
    return null;
  }
  const { a: left, b: right, x402Status } = data;
  const leftKeys = capSet(left);
  const rightKeys = capSet(right);
  const sharedCaps = [...leftKeys].filter((k) => rightKeys.has(k));
  const onlyLeft = [...leftKeys].filter((k) => !rightKeys.has(k));
  const onlyRight = [...rightKeys].filter((k) => !leftKeys.has(k));
  const protoLeft = new Set(left.protocols);
  const protoRight = new Set(right.protocols);
  const sharedProto = [...protoLeft].filter((p) => protoRight.has(p));
  const onlyProtoLeft = [...protoLeft].filter((p) => !protoRight.has(p));
  const onlyProtoRight = [...protoRight].filter((p) => !protoLeft.has(p));
  const tLeft = new Date(left.sapRegisteredAt || 0).getTime();
  const tRight = new Date(right.sapRegisteredAt || 0).getTime();
  const older: "a" | "b" | "tie" =
    !left.sapRegisteredAt || !right.sapRegisteredAt
      ? "tie"
      : tLeft < tRight
        ? "a"
        : tRight < tLeft
          ? "b"
          : "tie";
  const maxTiers = Math.max(left.tiers.length, right.tiers.length);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {[left, right].map((agent, idx) => {
          const isA = idx === 0;
          const x402 = isA ? x402Status.a : x402Status.b;
          return (
            <Card
              key={agent.sapAgentPda}
              className={cn(
                "border-border/80",
                isA ? "border-l-[3px] border-l-emerald-500/70" : "border-l-[3px] border-l-violet-500/50"
              )}
            >
              <CardHeader className="space-y-2 pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <SapVerifiedBadge sapAgentPda={agent.sapAgentPda} />
                  <X402Pill status={x402} />
                </div>
                <CardTitle className="text-lg leading-tight">{agent.name}</CardTitle>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-md bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    Profile {Math.round(agent.profileScore)}
                  </span>
                  <span className="rounded-md bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    Protocol trust {agent.protocolTrustScore}
                  </span>
                  {((isA && older === "a") || (!isA && older === "b")) && (
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-200">
                      Older registration
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={agent.profilePath}>Profile</Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={oobeExplorerAccountUrl(agent.sapAgentPda)} target="_blank" rel="noopener noreferrer">
                      Explorer <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                </div>
              </CardHeader>
            </Card>
          );
        })}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <CompareBlock title="SAP reputation & volume">
          <MetricRow
            label="Reputation (index)"
            left={left.reputation != null ? String(left.reputation) : "—"}
            right={right.reputation != null ? String(right.reputation) : "—"}
            match={left.reputation === right.reputation}
          />
          <MetricRow
            label="Tx count (SAP stats)"
            left={left.txCountLabel ?? "—"}
            right={right.txCountLabel ?? "—"}
            match={left.txCountLabel === right.txCountLabel}
          />
          <MetricRow
            label="Volume (proxy)"
            left={left.volumeLabel}
            right={right.volumeLabel}
            match={left.volumeLabel === right.volumeLabel}
          />
        </CompareBlock>
        <CompareBlock title="Registration">
          <MetricRow
            label="SAP registered"
            left={left.sapRegisteredAt ?? "—"}
            right={right.sapRegisteredAt ?? "—"}
            match={left.sapRegisteredAt === right.sapRegisteredAt}
          />
        </CompareBlock>
      </div>
      <CompareBlock title="Protocols">
        <div className="grid gap-3 md:grid-cols-2 text-xs">
          <div>
            <p className="mb-1 font-medium text-emerald-400/90">Shared</p>
            <div className="flex flex-wrap gap-1">
              {sharedProto.length ? (
                sharedProto.map((p) => (
                  <Badge key={p} className="border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                    {p}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 font-medium text-amber-400/90">A only</p>
              <div className="flex flex-wrap gap-1">
                {onlyProtoLeft.map((p) => (
                  <Badge key={p} variant="outline" className="border-amber-500/35 text-amber-200">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 font-medium text-amber-400/90">B only</p>
              <div className="flex flex-wrap gap-1">
                {onlyProtoRight.map((p) => (
                  <Badge key={p} variant="outline" className="border-amber-500/35 text-amber-200">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CompareBlock>
      <CompareBlock title="Capabilities">
        <div className="grid gap-3 md:grid-cols-3 text-xs">
          <div>
            <p className="mb-1 font-medium text-emerald-400/90">Shared ({sharedCaps.length})</p>
            <ul className="space-y-1 text-muted-foreground">
              {sharedCaps.map((k) => (
                <li key={k} className="rounded border border-emerald-500/25 bg-emerald-500/5 px-2 py-1 font-mono">
                  {k}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 font-medium text-amber-400/90">Only A ({onlyLeft.length})</p>
            <ul className="space-y-1">
              {onlyLeft.map((k) => (
                <li
                  key={k}
                  className="rounded border border-amber-500/25 bg-amber-500/5 px-2 py-1 font-mono text-amber-100/90"
                >
                  {k}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1 font-medium text-amber-400/90">Only B ({onlyRight.length})</p>
            <ul className="space-y-1">
              {onlyRight.map((k) => (
                <li
                  key={k}
                  className="rounded border border-amber-500/25 bg-amber-500/5 px-2 py-1 font-mono text-amber-100/90"
                >
                  {k}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CompareBlock>
      <CompareBlock title="Pricing tiers">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">A tier</th>
                <th className="py-2 pr-2">B tier</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxTiers }).map((_, i) => {
                const tl = left.tiers[i];
                const tr = right.tiers[i];
                const match =
                  Boolean(tl && tr) &&
                  String(tl!.tierId) === String(tr!.tierId) &&
                  String(tl!.pricePerCall) === String(tr!.pricePerCall);
                return (
                  <tr
                    key={i}
                    className={cn(
                      "border-b border-border/40",
                      match ? "bg-emerald-500/[0.06]" : "bg-amber-500/[0.04]"
                    )}
                  >
                    <td className="py-2 pr-2 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-2 font-mono">
                      {tl ? `${tl.tierId ?? "—"} / ${tl.pricePerCall ?? "—"}` : "—"}
                    </td>
                    <td className="py-2 pr-2 font-mono">
                      {tr ? `${tr.tierId ?? "—"} / ${tr.pricePerCall ?? "—"}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CompareBlock>
      <CompareBlock title="x402 endpoint">
        <div className="grid gap-3 md:grid-cols-2 text-xs">
          <div className="rounded-md border border-border/60 bg-muted/10 p-2 font-mono break-all text-[11px]">
            {left.sapX402Endpoint ?? "—"}
          </div>
          <div className="rounded-md border border-border/60 bg-muted/10 p-2 font-mono break-all text-[11px]">
            {right.sapX402Endpoint ?? "—"}
          </div>
        </div>
      </CompareBlock>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Refreshing…
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
    </div>
  );
}
function CompareBlock({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Card className="border-border/80 bg-card/40">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}
function MetricRow({
  label,
  left,
  right,
  match,
}: {
  readonly label: string;
  readonly left: string;
  readonly right: string;
  readonly match: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_1fr_1fr] gap-2 rounded-md border px-2 py-1.5 text-[11px]",
        match ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{left}</span>
      <span className="font-mono">{right}</span>
    </div>
  );
}