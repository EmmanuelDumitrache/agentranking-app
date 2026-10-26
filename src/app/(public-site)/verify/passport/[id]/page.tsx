"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { VerifiedAgentBadge } from "@/components/verification/verified-agent-badge";
import { publicKeys } from "@/lib/query-keys/public";
import type { RiskTier } from "@/lib/verification/providers/types";

type PassportView = {
  passport: {
    id: string;
    status: string;
    riskTier: RiskTier;
    riskScore: number;
    ownerWallet: string;
    ownerWalletChain: string;
    issuedAt: string | null;
    expiresAt: string | null;
    lastScreenedAt: string | null;
    passportHash: string;
    anchorTx: string | null;
  };
  agent: { id: number; name: string; chainId: number; score: number };
  factors: Record<string, { points: number; max: number }> | null;
  delegations: Array<{
    id: string;
    delegatedWallet: string;
    scopes: string[];
    agent: { id: number; name: string };
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    createdAt: string;
  }>;
};

export default function PassportPublicPage() {
  const params = useParams<{ id: string }>();
  const { data, error } = useQuery<PassportView>({
    queryKey: publicKeys.passport(params.id ?? ""),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/verification/passport/${params.id}`, { signal });
      const body = (await res.json()) as PassportView & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Not found");
      return body;
    },
    enabled: Boolean(params.id),
  });

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-sm text-white/60">
        {error instanceof Error ? error.message : "Failed to load"}
      </main>
    );
  }
  if (!data) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-sm text-white/40">Loading passport…</main>
    );
  }

  const { passport, agent, factors, delegations, events } = data;

  return (
    <main className="min-h-[70vh] bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.05),_transparent_50%),#0f1011]">
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">Agent Passport</p>
        <h1 className="mt-2 text-3xl font-semibold text-white/95">{agent.name}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <VerifiedAgentBadge tier={passport.riskTier} score={passport.riskScore} />
          <span className="text-xs uppercase tracking-wide text-white/40">{passport.status}</span>
        </div>

        <section className="mt-8 rounded-xl border border-white/10 bg-[#18191b] p-5">
          <p className="text-4xl font-semibold tabular-nums text-white/95">
            {passport.riskScore}
            <span className="ml-1 text-base font-normal text-white/35">/ 100</span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-white/45">
            <div>
              <dt>Issued</dt>
              <dd className="text-white/75">{passport.issuedAt ?? "—"}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd className="text-white/75">{passport.expiresAt ?? "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt>Owner wallet</dt>
              <dd className="break-all font-mono text-[11px] text-white/70">{passport.ownerWallet}</dd>
            </div>
            <div className="col-span-2">
              <dt>Attestation hash</dt>
              <dd className="break-all font-mono text-[10px] text-white/40">{passport.passportHash}</dd>
            </div>
          </dl>
        </section>

        {factors ? (
          <section className="mt-6">
            <h2 className="text-sm font-medium text-white/80">Score breakdown</h2>
            <ul className="mt-3 space-y-2">
              {Object.entries(factors).map(([key, value]) => (
                <li
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-white/8 bg-[#18191b] px-3 py-2 text-sm"
                >
                  <span className="text-white/60">{key}</span>
                  <span className="tabular-nums text-white/90">
                    {value.points}
                    <span className="text-white/35">/{value.max}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="text-sm font-medium text-white/80">Delegated agents</h2>
          {delegations.length === 0 ? (
            <p className="mt-2 text-sm text-white/40">No active delegations.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {delegations.map((d) => (
                <li
                  key={d.id}
                  className="rounded-lg border border-white/8 bg-[#18191b] px-3 py-2 text-sm"
                >
                  <p className="text-white/85">{d.agent.name}</p>
                  <p className="font-mono text-[11px] text-white/40">{d.delegatedWallet}</p>
                  <p className="text-[11px] text-white/35">{d.scopes.join(", ")}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-medium text-white/80">Verification history</h2>
          <ol className="mt-3 space-y-2 border-l border-white/10 pl-4">
            {events.map((e) => (
              <li key={e.id} className="relative text-sm">
                <span className="absolute -left-[1.28rem] top-1.5 h-2 w-2 rounded-full bg-white/40" />
                <p className="text-white/80">{e.eventType}</p>
                <p className="text-[11px] text-white/35">{e.createdAt}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
