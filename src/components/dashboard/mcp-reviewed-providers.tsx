"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, FlaskConical, KeyRound, Search, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DashboardMcpProvider, DashboardMcpProviderAuth } from "@/features/agent-chat/shared/mcp-dashboard-types";
import { cn } from "@/lib/utils";

function readable(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function mcpProviderAuthLabel(auth: DashboardMcpProviderAuth): string {
  if (auth.kind === "api-key-header") return `API key (${auth.headerName ?? "reviewed header"})`;
  if (auth.kind === "api-key-query") return "API key (secure URL injection)";
  if (auth.kind === "api-key-tool-argument") return "API key (secure tool injection)";
  if (auth.kind === "oauth2") return "OAuth authorization";
  if (auth.kind === "client-credentials") return "OAuth client credentials";
  if (auth.kind === "bearer") return "Bearer token";
  return "No authentication";
}

export function McpProviderIcon({
  providerKey: _providerKey,
  displayName,
  brand,
  className,
}: {
  providerKey: string | null;
  displayName: string;
  brand?: DashboardMcpProvider["brand"];
  className?: string;
}) {
  const fallback = brand?.mark ?? (
    displayName
      .split(/[^A-Za-z0-9]+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "M"
  );

  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-muted text-[10px] font-black text-foreground shadow-sm", className)}
      style={brand ? { backgroundColor: brand.background, color: brand.foreground } : undefined}
    >
      <span className="leading-none">{fallback}</span>
      {brand?.iconUrl ? (
        // Provider-controlled image URLs are reviewed as part of the manifest.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          src={brand.iconUrl}
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full bg-white object-contain p-1.5"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      ) : null}
    </span>
  );
}

const sectionOrder: DashboardMcpProvider["priority"][] = ["P0", "P1", "P2", "ACTION", "WATCH"];
const sectionLabels: Record<DashboardMcpProvider["priority"], { title: string; description: string }> = {
  P0: { title: "Core data providers", description: "Highest-value, production-ready data and research connections." },
  P1: { title: "Specialized providers", description: "Deeper analytics, simulation, and infrastructure capabilities." },
  P2: { title: "Complementary data", description: "Trusted alternatives with meaningful overlap in the existing catalog." },
  ACTION: { title: "Execution and wallet providers", description: "Higher-risk tools use per-tool classification, confirmation, and hard execution boundaries." },
  WATCH: { title: "Beta and watchlist", description: "Visible for transparency; unavailable entries cannot be connected until they pass admission." },
};

function riskClass(risk: DashboardMcpProvider["riskLevel"]): string {
  if (risk === "LOW") return "border-emerald-500/30 text-emerald-700 dark:text-emerald-300";
  if (risk === "MODERATE") return "border-amber-500/30 text-amber-700 dark:text-amber-300";
  if (risk === "HIGH") return "border-orange-500/30 text-orange-700 dark:text-orange-300";
  return "border-red-500/30 text-red-700 dark:text-red-300";
}

function ProviderCard({
  provider,
  onConnect,
  disabled,
}: {
  provider: DashboardMcpProvider;
  onConnect: (provider: DashboardMcpProvider) => void;
  disabled: boolean;
}) {
  const unavailable = disabled || !provider.connectable;
  return (
    <article className={cn("flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4", !provider.connectable && "bg-muted/20 opacity-80")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <McpProviderIcon providerKey={provider.key} displayName={provider.displayName} brand={provider.brand} />
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{provider.displayName}</h3>
            <p className="truncate text-[11px] text-muted-foreground">by {provider.publisherName}</p>
          </div>
        </div>
        <Badge className={cn("shrink-0", riskClass(provider.riskLevel))} variant="outline">
          {readable(provider.riskLevel)} risk
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1">
        <Badge variant={provider.releaseStage === "GA" ? "secondary" : "outline"}>{readable(provider.releaseStage)}</Badge>
        <Badge variant="outline">{readable(provider.billingModel)}</Badge>
        {provider.toolAllowlistSupport ? <Badge variant="outline">Tool allowlist</Badge> : null}
      </div>
      <p className="min-h-14 text-xs leading-relaxed text-muted-foreground">{provider.summary}</p>
      <div className="flex flex-wrap gap-1">
        {provider.capabilityClasses.map((capability) => <Badge key={capability} variant="secondary">{readable(capability)}</Badge>)}
      </div>
      <div className="flex flex-wrap gap-1">
        {provider.chainFamilies.slice(0, 5).map((chain) => <Badge key={chain} variant="outline">{chain}</Badge>)}
        {provider.chainFamilies.length > 5 ? <Badge variant="outline">+{provider.chainFamilies.length - 5}</Badge> : null}
      </div>

      <div className="mt-auto space-y-2 border-t border-border/70 pt-3 text-[11px] text-muted-foreground">
        <p>{provider.transports.map(readable).join(" · ")} · Reviewed {provider.reviewedAt}</p>
        <p className="flex items-start gap-1.5"><KeyRound className="mt-0.5 size-3 shrink-0" /><span>{provider.authOptions.map(mcpProviderAuthLabel).join(" · ")}</span></p>
        <p className="flex items-start gap-1.5">
          {provider.requiresUserConfirmation ? <ShieldAlert className="mt-0.5 size-3 shrink-0 text-amber-400" /> : <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-400" />}
          <span>{provider.requiresUserConfirmation ? "State-changing tools require confirmation" : "Read-side defaults can run without confirmation"}</span>
        </p>
        {!provider.connectable ? (
          <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300"><FlaskConical className="mt-0.5 size-3 shrink-0" /><span>{provider.unavailableReason}</span></p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Link href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <BookOpen className="size-3" />Docs
        </Link>
        <Button size="sm" disabled={unavailable} title={provider.unavailableReason ?? undefined} onClick={() => onConnect(provider)}>
          {provider.connectable ? "Connect" : "Unavailable"}
        </Button>
      </div>
    </article>
  );
}

export function ReviewedMcpProviders({
  providers,
  onConnect,
  disabled = false,
}: {
  providers: DashboardMcpProvider[];
  onConnect: (provider: DashboardMcpProvider) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [capability, setCapability] = useState("ALL");
  const [risk, setRisk] = useState("ALL");
  const [stage, setStage] = useState("ALL");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return providers.filter((provider) => {
      if (capability !== "ALL" && !provider.capabilityClasses.includes(capability as never)) return false;
      if (risk !== "ALL" && provider.riskLevel !== risk) return false;
      if (stage !== "ALL" && provider.releaseStage !== stage) return false;
      if (!query) return true;
      return [provider.displayName, provider.publisherName, provider.summary, ...provider.categories, ...provider.chainFamilies, ...provider.capabilityClasses]
        .join(" ").toLowerCase().includes(query);
    });
  }, [capability, providers, risk, search, stage]);

  const sections = sectionOrder
    .map((priority) => ({ priority, providers: filtered.filter((provider) => provider.priority === priority) }))
    .filter((section) => section.providers.length > 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-2 rounded-xl border border-border bg-muted/20 p-3 md:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(150px,auto))]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${providers.length} providers`} className="pl-9" />
        </label>
        <label className="relative">
          <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <select aria-label="Filter by capability" value={capability} onChange={(event) => setCapability(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-8 text-sm">
            <option value="ALL">All capabilities</option>
            {["READ_ONLY", "ANALYTICS_QUERY", "SIMULATION", "TRANSACTION_PREP", "WALLET_APPROVAL", "TRADING", "PAID_CALLS", "ACCOUNT_ADMIN"].map((value) => <option key={value} value={value}>{readable(value)}</option>)}
          </select>
        </label>
        <select aria-label="Filter by risk" value={risk} onChange={(event) => setRisk(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="ALL">All risk levels</option>
          {["LOW", "MODERATE", "HIGH", "CRITICAL"].map((value) => <option key={value} value={value}>{readable(value)} risk</option>)}
        </select>
        <select aria-label="Filter by release stage" value={stage} onChange={(event) => setStage(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="ALL">All release stages</option>
          {["GA", "BETA", "EXPERIMENTAL", "EARLY_ACCESS", "WATCHLIST"].map((value) => <option key={value} value={value}>{readable(value)}</option>)}
        </select>
      </div>

      {sections.map((section) => (
        <section key={section.priority} className="space-y-3">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">{sectionLabels[section.priority].title}</h2><Badge variant="outline">{section.providers.length}</Badge></div>
            <p className="mt-0.5 text-xs text-muted-foreground">{sectionLabels[section.priority].description}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {section.providers.map((provider) => <ProviderCard key={provider.key} provider={provider} onConnect={onConnect} disabled={disabled} />)}
          </div>
        </section>
      ))}
      {!sections.length ? <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No providers match these filters.</div> : null}
    </div>
  );
}
