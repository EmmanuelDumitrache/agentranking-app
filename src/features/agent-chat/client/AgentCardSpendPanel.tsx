"use client";

import { memo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Props = {
  agentDbId: number;
};

type StatusResponse = {
  configured: boolean;
  message?: string;
  error?: string;
  readiness?: {
    spendReady: boolean;
    paymentMethodReady: boolean;
    agentEmailReady: boolean;
    walletReady: boolean;
    identityStatus: string;
    identityRequired: boolean;
    identityUrl: string | null;
    email: string | null;
    agentEmail: string | null;
    messages: string[];
    limits: {
      spendLimitDollars: number;
      spentDollars: number;
      remainingDollars: number;
    } | null;
  };
  recentRequests?: Array<{
    id: string;
    amountDollars: number;
    status: string;
    createdAt: string;
    expiresAt: string;
    last4: string | null;
    merchant: string | null;
  }>;
};

type RevealResponse = {
  sensitive: true;
  id: string;
  card: {
    pan: string;
    cvv: string;
    expiry: string;
    zip: string | null;
    cardholderName: string;
    billingAddress: string;
  };
  message: string;
};

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

type ThreeDsResponse = {
  sensitive: true;
  id: string;
  codes: Array<{
    code: string;
    match: string | null;
    merchant: string | null;
    amountDollars: number | null;
    currency: string | null;
    reasons: string[];
  }>;
  message: string;
};

function StatusPill({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}) {
  return (
    <Badge
      variant={ok ? "secondary" : "outline"}
      className={cn(
        "text-[10px]",
        ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400",
      )}
    >
      {label}
    </Badge>
  );
}

function AgentCardSpendPanelComponent({ agentDbId }: Props) {
  const [revealed, setRevealed] = useState<RevealResponse | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [threeDs, setThreeDs] = useState<ThreeDsResponse | null>(null);
  const [showThreeDs, setShowThreeDs] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["agentcard", "status", agentDbId],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/dashboard/agents/${agentDbId}/agentcard/status`,
        { signal },
      );
      if (!res.ok) throw new Error("Could not load AgentCard status");
      return (await res.json()) as StatusResponse;
    },
    staleTime: 30_000,
    retry: 1,
  });

  const revealMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await fetch(
        `/api/dashboard/agents/${agentDbId}/agentcard/reveal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Reveal failed",
        );
      }
      return data as RevealResponse;
    },
    onSuccess: (data) => {
      setRevealed(data);
      setShowSecrets(true);
    },
  });

  const threeDsMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await fetch(
        `/api/dashboard/agents/${agentDbId}/agentcard/3ds`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "3DS lookup failed",
        );
      }
      return data as ThreeDsResponse;
    },
    onSuccess: (data) => {
      setThreeDs(data);
      setShowThreeDs(true);
    },
  });

  if (statusQuery.isLoading) {
    return (
      <div className="space-y-2" aria-label="Loading AgentCard" role="status">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  if (statusQuery.isError) {
    return (
      <div
        className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-[#212121] bg-[#181818] p-3 text-xs text-muted-foreground"
        role="alert"
      >
        <span>AgentCard status could not be refreshed.</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 text-xs"
          disabled={statusQuery.isFetching}
          onClick={() => void statusQuery.refetch()}
        >
          {statusQuery.isFetching ? (
            <>
              <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
              Retrying…
            </>
          ) : (
            "Retry"
          )}
        </Button>
      </div>
    );
  }

  if (!statusQuery.data?.configured) return null;

  const data = statusQuery.data;
  const readiness = data.readiness;
  const identityUrl = safeHttpUrl(readiness?.identityUrl);
  const actionError = revealMutation.isError
    ? revealMutation.error instanceof Error
      ? revealMutation.error.message
      : "Could not reveal this card."
    : threeDsMutation.isError
      ? threeDsMutation.error instanceof Error
        ? threeDsMutation.error.message
        : "Could not load a 3DS code."
      : null;

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-2">
        <CreditCard aria-hidden className="size-3.5 text-muted-foreground" />
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          AgentCard spend
        </p>
      </div>

      {data.error ? (
        <p className="text-xs text-destructive" role="alert">
          {data.error}
        </p>
      ) : null}

      {readiness ? (
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex flex-wrap gap-1.5">
            <StatusPill ok={readiness.paymentMethodReady} label="Payment" />
            <StatusPill ok={readiness.walletReady} label="Wallet" />
            <StatusPill
              ok={!readiness.identityRequired}
              label={
                readiness.identityRequired ? "KYC required" : "KYC ok"
              }
            />
            <StatusPill ok={readiness.spendReady} label="Spend ready" />
          </div>

          {readiness.limits ? (
            <p className="text-xs text-muted-foreground">
              Daily limit: ${readiness.limits.remainingDollars.toFixed(2)} remaining
              of ${readiness.limits.spendLimitDollars.toFixed(2)} (AgentCard).
              Per-card max $150.
            </p>
          ) : null}

          {readiness.messages.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {readiness.messages.map((message) => (
                <li key={message} className="flex gap-1.5">
                  <AlertTriangle
                    aria-hidden
                    className="mt-0.5 size-3 shrink-0 text-amber-600"
                  />
                  <span>{message}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {identityUrl ? (
            <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
              <a
                href={identityUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Complete KYC
                <ExternalLink aria-hidden className="ml-1 size-3" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
          ) : null}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Ask the agent to issue a single-use card in chat. Unused holds release
            on cancel or after ~7 days.
          </p>
        </div>
      ) : null}

      {actionError ? (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
          role="alert"
        >
          {actionError}
        </p>
      ) : null}

      {data.recentRequests && data.recentRequests.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Recent requests
          </p>
          <ul className="space-y-2">
            {data.recentRequests.map((item) => {
              const canReveal =
                item.status === "ready" || item.status === "issued";
              const isRevealed = revealed?.id === item.id;
              return (
                <li
                  key={item.id}
                  className="rounded-md border border-border/50 bg-background/60 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className="truncate font-mono text-[11px]"
                        title={item.id}
                      >
                        {item.id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        ${item.amountDollars.toFixed(2)} · {item.status}
                        {item.last4 ? ` · •${item.last4}` : ""}
                      </p>
                    </div>
                    {canReveal ? (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px]"
                          disabled={revealMutation.isPending}
                          onClick={() => revealMutation.mutate(item.id)}
                        >
                          {revealMutation.isPending &&
                          revealMutation.variables === item.id ? (
                            <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
                          ) : (
                            "Reveal card"
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px]"
                          disabled={threeDsMutation.isPending}
                          onClick={() => threeDsMutation.mutate(item.id)}
                        >
                          {threeDsMutation.isPending &&
                          threeDsMutation.variables === item.id ? (
                            <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
                          ) : (
                            "3DS code"
                          )}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {isRevealed && revealed ? (
                    <div className="mt-2 space-y-2 rounded border border-amber-500/30 bg-amber-500/5 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-amber-800 dark:text-amber-300">
                          Sensitive — copy now
                        </p>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => setShowSecrets((v) => !v)}
                          aria-label={showSecrets ? "Hide card" : "Show card"}
                        >
                          {showSecrets ? (
                            <EyeOff aria-hidden className="size-3.5" />
                          ) : (
                            <Eye aria-hidden className="size-3.5" />
                          )}
                        </Button>
                      </div>
                      {showSecrets ? (
                        <dl className="grid gap-1 font-mono text-[11px]">
                          <div>
                            <dt className="text-muted-foreground">PAN</dt>
                            <dd>{revealed.card.pan}</dd>
                          </div>
                          <div className="flex gap-4">
                            <div>
                              <dt className="text-muted-foreground">Expiry</dt>
                              <dd>{revealed.card.expiry}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">CVV</dt>
                              <dd>{revealed.card.cvv}</dd>
                            </div>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Billing</dt>
                            <dd className="break-words">
                              {revealed.card.billingAddress}
                            </dd>
                          </div>
                        </dl>
                      ) : (
                        <p className="font-mono text-[11px] text-muted-foreground">
                          •••• •••• •••• ••••
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        {revealed.message}
                      </p>
                    </div>
                  ) : null}
                  {threeDs?.id === item.id ? (
                    <div className="mt-2 space-y-2 rounded border border-amber-500/30 bg-amber-500/5 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-amber-800 dark:text-amber-300">
                          Sensitive 3DS challenge
                        </p>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => setShowThreeDs((value) => !value)}
                          aria-label={showThreeDs ? "Hide 3DS codes" : "Show 3DS codes"}
                        >
                          {showThreeDs ? (
                            <EyeOff aria-hidden className="size-3.5" />
                          ) : (
                            <Eye aria-hidden className="size-3.5" />
                          )}
                        </Button>
                      </div>
                      {showThreeDs ? (
                        threeDs.codes.length > 0 ? (
                          <div className="space-y-1.5">
                            {threeDs.codes.map((code, index) => (
                              <div
                                key={`${code.code}:${index}`}
                                className="rounded border border-border/50 bg-background/70 px-2 py-1.5"
                              >
                                <p className="font-mono text-sm font-semibold tracking-widest">
                                  {code.code}
                                </p>
                                <p className="break-words text-[10px] text-muted-foreground">
                                  {[
                                    code.merchant,
                                    code.amountDollars == null
                                      ? null
                                      : `${code.currency ?? "USD"} ${code.amountDollars.toFixed(2)}`,
                                    code.match,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            No matching code is available yet. Retry after checkout sends the challenge.
                          </p>
                        )
                      ) : (
                        <p className="font-mono text-[11px] text-muted-foreground">••••••</p>
                      )}
                      <p className="break-words text-[10px] text-muted-foreground">
                        {threeDs.message}
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-0 text-[11px] text-muted-foreground"
        disabled={statusQuery.isFetching}
        onClick={() => void statusQuery.refetch()}
      >
        {statusQuery.isFetching ? (
          <>
            <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
            Refreshing…
          </>
        ) : (
          "Refresh status"
        )}
      </Button>
    </div>
  );
}

export const AgentCardSpendPanel = memo(AgentCardSpendPanelComponent);
