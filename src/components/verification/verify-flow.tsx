"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import bs58 from "bs58";
import { useAccount, useSignMessage } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { VerifiedAgentBadge } from "@/components/verification/verified-agent-badge";
import type { RiskTier } from "@/lib/verification/providers/types";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3 | 4 | 5;

type AgentHit = {
  id: number;
  agentId: number;
  chainId: number;
  name: string;
  score: number;
  image?: string;
  owner?: string;
};

type FactorRow = { key: string; points: number; max: number };

type PassportResult = {
  id: string;
  status: string;
  riskTier: RiskTier;
  riskScore: number;
  passportHash: string;
};

const FACTOR_ORDER = [
  "ownershipProven",
  "onchainAgeDays",
  "transactionHistory",
  "counterpartyDiversity",
  "endpointLiveness",
  "capabilityDeclaration",
  "sanctionsScreening",
  "platformReputation",
] as const;

function labelFactor(key: string): string {
  switch (key) {
    case "ownershipProven":
      return "Ownership proven";
    case "onchainAgeDays":
      return "On-chain age";
    case "transactionHistory":
      return "Transaction history";
    case "counterpartyDiversity":
      return "Counterparty diversity";
    case "endpointLiveness":
      return "Endpoint liveness";
    case "capabilityDeclaration":
      return "Capability declaration";
    case "sanctionsScreening":
      return "Sanctions screening";
    case "platformReputation":
      return "Platform reputation";
    default:
      return key;
  }
}

async function signWithSolana(message: string): Promise<{ address: string; signature: string } | null> {
  const provider = (
    window as unknown as {
      solana?: {
        isPhantom?: boolean;
        publicKey?: { toBase58(): string };
        connect(): Promise<void>;
        signMessage(msg: Uint8Array, display?: string): Promise<{ signature: Uint8Array }>;
      };
    }
  ).solana;
  if (!provider?.signMessage) return null;
  if (!provider.publicKey) await provider.connect();
  const encoded = new TextEncoder().encode(message);
  const { signature } = await provider.signMessage(encoded, "utf8");
  return {
    address: provider.publicKey!.toBase58(),
    signature: bs58.encode(signature),
  };
}

export function VerifyFlow() {
  const [step, setStep] = useState<Step>(1);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AgentHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AgentHit | null>(null);
  const [chain, setChain] = useState<"solana" | "evm">("evm");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [factors, setFactors] = useState<FactorRow[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [passport, setPassport] = useState<PassportResult | null>(null);
  const [limitUsd, setLimitUsd] = useState(0);
  const [delegateAgentId, setDelegateAgentId] = useState("");
  const [delegateWallet, setDelegateWallet] = useState("");
  const [delegationOk, setDelegationOk] = useState(false);

  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { openConnectModal } = useConnectModal();

  useEffect(() => {
    if (!query.trim()) return;
    const handle = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/verification/agents?q=${encodeURIComponent(query.trim())}&limit=8`,
        );
        const data = (await res.json()) as {
          agents?: AgentHit[];
        };
        setHits(data.agents ?? []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (step !== 3 || factors.length === 0) return;
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i >= factors.length) window.clearInterval(timer);
    }, 220);
    return () => window.clearInterval(timer);
  }, [step, factors]);

  const progress = useMemo(() => ((step - 1) / 4) * 100, [step]);

  const finishAssessment = useCallback(
    (verifyBody: {
      passport?: PassportResult;
      assessment?: {
        factors: Record<string, { points: number; max: number }>;
        score: number;
        tier: RiskTier;
      };
    }) => {
      const factorRows: FactorRow[] = FACTOR_ORDER.map((key) => {
        const f = verifyBody.assessment?.factors?.[key];
        return { key, points: f?.points ?? 0, max: f?.max ?? 0 };
      });
      setFactors(factorRows);
      setPassport(verifyBody.passport ?? null);
      setRevealed(0);
      setStep(3);

      window.setTimeout(() => {
        void (async () => {
          try {
            const p = verifyBody.passport;
            if (!p) return;
            const detail = await fetch(`/api/verification/passport/${p.id}`);
            const detailBody = (await detail.json()) as {
              passport?: {
                ownerWallet?: string;
                riskTier?: RiskTier;
                riskScore?: number;
                passportHash?: string;
                status?: string;
              };
            };
            const w = detailBody.passport?.ownerWallet;
            if (w) {
              const oracle = await fetch(`/api/oracle/agent-risk?wallet=${encodeURIComponent(w)}`);
              const oracleBody = (await oracle.json()) as {
                recommendation?: { maxDailyLimitUsd?: number };
              };
              setLimitUsd(oracleBody.recommendation?.maxDailyLimitUsd ?? 0);
            }
            setPassport({
              id: p.id,
              status: detailBody.passport?.status ?? p.status,
              riskTier: (detailBody.passport?.riskTier ??
                verifyBody.assessment?.tier ??
                "UNRATED") as RiskTier,
              riskScore: detailBody.passport?.riskScore ?? verifyBody.assessment?.score ?? 0,
              passportHash: detailBody.passport?.passportHash ?? p.passportHash,
            });
          } catch {
            /* ignore */
          }
          setStep(4);
        })();
      }, Math.max(900, factorRows.length * 220 + 400));
    },
    [],
  );

  const runOwnership = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      let walletAddress = "";
      if (chain === "evm") {
        if (!isConnected || !address) {
          openConnectModal?.();
          setBusy(false);
          return;
        }
        walletAddress = address;
      } else {
        const provider = (
          window as unknown as {
            solana?: { publicKey?: { toBase58(): string }; connect(): Promise<void> };
          }
        ).solana;
        if (!provider) throw new Error("Solana wallet (Phantom) not available");
        if (!provider.publicKey) await provider.connect();
        walletAddress = provider.publicKey!.toBase58();
      }

      const challenge = await fetch("/api/verification/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: selected.id,
          walletAddress,
          chain,
        }),
      });
      const challengeBody = (await challenge.json()) as {
        message?: string;
        nonce?: string;
        error?: string;
      };
      if (!challenge.ok || !challengeBody.message || !challengeBody.nonce) {
        throw new Error(challengeBody.error ?? "Challenge failed");
      }

      let signature = "";
      if (chain === "evm") {
        signature = await signMessageAsync({ message: challengeBody.message });
      } else {
        const signed = await signWithSolana(challengeBody.message);
        if (!signed) throw new Error("Solana signing failed");
        signature = signed.signature;
        walletAddress = signed.address;
      }

      const verifyRes = await fetch("/api/verification/verify-ownership", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: selected.id,
          walletAddress,
          chain,
          signature,
          nonce: challengeBody.nonce,
        }),
      });
      const verifyBody = (await verifyRes.json()) as {
        error?: string;
        passport?: PassportResult;
        assessment?: {
          factors: Record<string, { points: number; max: number }>;
          score: number;
          tier: RiskTier;
        };
      };
      if (!verifyRes.ok) throw new Error(verifyBody.error ?? "Verification failed");
      finishAssessment(verifyBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }, [
    address,
    chain,
    finishAssessment,
    isConnected,
    openConnectModal,
    selected,
    signMessageAsync,
  ]);

  const runDelegate = useCallback(async () => {
    if (!passport) return;
    setBusy(true);
    setError(null);
    try {
      const delegatedAgentId = Number(delegateAgentId);
      if (!Number.isInteger(delegatedAgentId) || delegatedAgentId <= 0) {
        throw new Error("Enter a valid delegated agent database id");
      }
      if (!delegateWallet.trim()) throw new Error("Enter delegated wallet");

      const challengeRes = await fetch("/api/verification/delegate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentPassportId: passport.id,
          delegatedAgentId,
          delegatedWallet: delegateWallet.trim(),
          scopes: ["card.issue", "card.spend"],
        }),
      });
      const challengeBody = (await challengeRes.json()) as {
        message?: string;
        nonce?: string;
        error?: string;
      };
      if (!challengeRes.ok || !challengeBody.message || !challengeBody.nonce) {
        throw new Error(challengeBody.error ?? "Delegation challenge failed");
      }

      let signature = "";
      if (chain === "evm") {
        signature = await signMessageAsync({ message: challengeBody.message });
      } else {
        const signed = await signWithSolana(challengeBody.message);
        if (!signed) throw new Error("Solana signing failed");
        signature = signed.signature;
      }

      const confirmRes = await fetch("/api/verification/delegate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentPassportId: passport.id,
          delegatedAgentId,
          delegatedWallet: delegateWallet.trim(),
          scopes: ["card.issue", "card.spend"],
          signature,
          nonce: challengeBody.nonce,
        }),
      });
      const confirmBody = (await confirmRes.json()) as { error?: string };
      if (!confirmRes.ok) throw new Error(confirmBody.error ?? "Delegation failed");
      setDelegationOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delegation failed");
    } finally {
      setBusy(false);
    }
  }, [chain, delegateAgentId, delegateWallet, passport, signMessageAsync]);

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10 sm:py-14">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">Know Your Agent</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white/95 sm:text-4xl">
          AgentRanking
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-white/55">
          Prove wallet control, earn an Agent Risk Tier, and unlock card spend limits — without
          submitting personal documents.
        </p>
      </div>

      <div className="mb-6 h-1 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full bg-white/70 transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="mb-8 flex gap-2 text-[10px] uppercase tracking-wider text-white/35">
        {(["Select", "Sign", "Score", "Passport", "Delegate"] as const).map((label, i) => (
          <li
            key={label}
            className={cn(
              "rounded-md px-2 py-1",
              step === i + 1 && "bg-white/10 text-white/80",
              step > i + 1 && "text-white/55",
            )}
          >
            {label}
          </li>
        ))}
      </ol>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-white/90">Select an agent</h2>
          <input
            value={query}
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              if (!next.trim()) {
                setHits([]);
                setSearching(false);
              }
            }}
            placeholder="Search the index…"
            className="w-full rounded-lg border border-white/10 bg-[#18191b] px-3 py-2.5 text-sm text-white/90 outline-none ring-0 placeholder:text-white/30 focus:border-white/25"
          />
          <div className="space-y-2">
            {searching ? <p className="text-xs text-white/40">Searching…</p> : null}
            {hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => {
                  setSelected(hit);
                  setStep(2);
                }}
                className="flex w-full items-center justify-between rounded-lg border border-white/8 bg-[#18191b] px-3 py-3 text-left transition hover:border-white/18 hover:bg-[#1b1d20]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white/90">{hit.name}</span>
                  <span className="block text-[11px] text-white/35">
                    db:{hit.id} · on-chain:{hit.agentId} · chain:{hit.chainId}
                  </span>
                </span>
                <span className="tabular-nums text-xs text-white/50">{Math.round(hit.score)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === 2 && selected ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-white/90">Prove ownership</h2>
          <p className="text-sm text-white/50">
            Selected <span className="text-white/80">{selected.name}</span>. Sign a one-time message
            from the controlling wallet.
          </p>
          <div className="flex gap-2">
            {(["evm", "solana"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChain(c)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs uppercase tracking-wide",
                  chain === c
                    ? "border-white/30 bg-white/10 text-white/90"
                    : "border-white/10 text-white/45",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          {chain === "evm" && !isConnected ? (
            <button
              type="button"
              onClick={() => openConnectModal?.()}
              className="w-full rounded-lg border border-white/15 bg-white/8 px-3 py-2.5 text-sm text-white/90"
            >
              Connect EVM wallet
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void runOwnership()}
            className="w-full rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-black disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Sign ownership proof"}
          </button>
          <button
            type="button"
            onClick={() => setStep(1)}
            className="text-xs text-white/40 underline-offset-2 hover:underline"
          >
            Back
          </button>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-white/90">Risk assessment</h2>
          <p className="text-sm text-white/50">Scoring agent signals…</p>
          <ul className="space-y-2">
            {factors.map((f, i) => (
              <li
                key={f.key}
                className={cn(
                  "flex items-center justify-between rounded-lg border border-white/8 bg-[#18191b] px-3 py-2 text-sm transition",
                  i < revealed ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
                )}
                style={{ transitionDuration: "400ms" }}
              >
                <span className="text-white/70">{labelFactor(f.key)}</span>
                <span className="tabular-nums text-white/90">
                  {f.points}
                  <span className="text-white/35">/{f.max}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {step === 4 && passport ? (
        <section className="space-y-5">
          <h2 className="text-lg font-medium text-white/90">Passport issued</h2>
          <div className="rounded-xl border border-white/10 bg-gradient-to-b from-[#1b1d20] to-[#141516] p-5">
            <VerifiedAgentBadge tier={passport.riskTier} score={passport.riskScore} />
            <p className="mt-4 text-4xl font-semibold tabular-nums tracking-tight text-white/95">
              {passport.riskScore}
              <span className="ml-1 text-base font-normal text-white/35">/ 100</span>
            </p>
            <p className="mt-2 text-sm text-white/50">
              Card limit unlocked:{" "}
              <span className="text-white/85">${limitUsd.toLocaleString()}/day</span>
            </p>
            <p className="mt-4 break-all font-mono text-[10px] text-white/30">
              {passport.passportHash}
            </p>
            <Link
              href={`/verify/passport/${passport.id}`}
              className="mt-4 inline-block text-xs text-white/55 underline-offset-2 hover:underline"
            >
              Open public passport
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setStep(5)}
            className="w-full rounded-lg border border-white/15 bg-white/8 px-3 py-2.5 text-sm text-white/90"
          >
            Delegate to another agent
          </button>
        </section>
      ) : null}

      {step === 5 && passport ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium text-white/90">Delegate</h2>
          <p className="text-sm text-white/50">
            One operator passport can authorize additional agents with scoped permissions.
          </p>
          <input
            value={delegateAgentId}
            onChange={(e) => setDelegateAgentId(e.target.value)}
            placeholder="Delegated agent db id"
            className="w-full rounded-lg border border-white/10 bg-[#18191b] px-3 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30"
          />
          <input
            value={delegateWallet}
            onChange={(e) => setDelegateWallet(e.target.value)}
            placeholder="Delegated wallet"
            className="w-full rounded-lg border border-white/10 bg-[#18191b] px-3 py-2.5 text-sm text-white/90 outline-none placeholder:text-white/30"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void runDelegate()}
            className="w-full rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-black disabled:opacity-50"
          >
            {busy ? "Signing…" : "Sign delegation"}
          </button>
          {delegationOk ? (
            <p className="text-sm text-emerald-200/90">Delegation active.</p>
          ) : null}
          <Link
            href={`/verify/passport/${passport.id}`}
            className="inline-block text-xs text-white/45 underline-offset-2 hover:underline"
          >
            Done — view passport
          </Link>
        </section>
      ) : null}
    </div>
  );
}
