"use client";

import { useCallback, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Fingerprint,
  Loader2,
} from "lucide-react";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast-simple";
import {
  solscanAccountUrl,
  solscanTransactionUrl,
} from "@/lib/agent-solana-registration/constants";
import { openDashboardAgentWallet } from "@/lib/dashboard/agent-wallet-ui";
import type { AgentSolanaRegistrationPageData } from "@/lib/agent-solana-registration/types";
import { cn } from "@/lib/utils";

type Props = {
  readonly initialData: AgentSolanaRegistrationPageData;
};

function formatRegisteredDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const isDateOnly =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  if (isDateOnly) return null;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function headerCopy(data: AgentSolanaRegistrationPageData): string {
  if (data.status === "registered") {
    return `${data.agentName} is listed on public directories. Other agent explorers can show the same picture, profile, and capabilities.`;
  }
  if (data.origin === "imported" && data.registration) {
    return `${data.agentName} was imported from an existing on-chain identity. List it on public directories so other explorers can find it.`;
  }
  return `Created agents are listed on public directories. Confirm registration so other explorers can show ${data.agentName}'s picture, profile, and capabilities.`;
}

function importedIdentityLabel(kind: "sap" | "metaplex" | null): string {
  return kind === "sap" ? "Imported SAP identity" : "Imported identity";
}

function directoryTrackBody(data: AgentSolanaRegistrationPageData, directoryDone: boolean): string {
  if (directoryDone) {
    return "Name, picture, and capabilities are on-chain. Other agent explorers can list this agent.";
  }
  if (data.origin === "imported") {
    return "Imported agents still need a public directory listing so other 8004 explorers can find them.";
  }
  return "Name, picture, and capabilities are written on-chain so other agent explorers can list this agent.";
}

function trackCardLabel(state: "done" | "ready" | "waiting"): string {
  if (state === "done") return "Done";
  if (state === "ready") return "Included";
  return "Needs token";
}

function CopyRow({
  label,
  value,
  href,
}: {
  readonly label: string;
  readonly value: string;
  readonly href?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      showToast("Copied", "success");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast("Could not copy", "error");
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#303030] bg-[#212121] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#c7c7c7]">{label}</p>
        <p className="mt-0.5 truncate font-mono text-xs text-[#f1f1f1]">{value}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full text-[#aaa] hover:bg-[#303030] hover:text-[#f1f1f1]"
          onClick={() => void copy()}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[#f1f1f1]" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="sr-only">Copy {label}</span>
        </button>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="flex size-8 items-center justify-center rounded-full text-[#aaa] hover:bg-[#303030] hover:text-[#f1f1f1]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="sr-only">Open {label}</span>
          </a>
        ) : null}
      </div>
    </div>
  );
}

function trackState(done: boolean, ready: boolean): "done" | "ready" | "waiting" {
  if (done) return "done";
  if (ready) return "ready";
  return "waiting";
}

function TrackCard({
  title,
  body,
  state,
}: {
  readonly title: string;
  readonly body: string;
  readonly state: "done" | "ready" | "waiting";
}) {
  const label = trackCardLabel(state);
  return (
    <div className="rounded-xl border border-[#303030] bg-[#212121] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-[#f1f1f1]">{title}</p>
        {state === "done" ? (
          <Check className="h-4 w-4 shrink-0 text-[#f1f1f1]" aria-label="Complete" />
        ) : (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              state === "ready" && "bg-white/10 text-[#f1f1f1]",
              state === "waiting" && "bg-transparent text-[#aaa]",
            )}
          >
            {label}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-[#aaa]">{body}</p>
    </div>
  );
}

export function AgentRegisterPage({ initialData }: Props) {
  const [data, setData] = useState(initialData);
  const [registering, setRegistering] = useState(false);

  const apiBase = `/api/dashboard/agents/${data.agentDbId}/register`;
  const isRegistered = data.status === "registered";
  const directoryDone = Boolean(data.registration?.directoryPda || data.registration?.directoryAsset);
  const arDone = Boolean(data.registration?.arIdentityPda);
  const arState = trackState(arDone, Boolean(data.tokenMint));
  const showRegisterPanel = data.canListPublicDirectory || data.canStampArIdentity;
  const proofHeading =
    data.origin === "imported" && !directoryDone ? "Imported identity" : "On-chain proof";
  const canSubmitRegister =
    data.status !== "no_wallet" &&
    data.status !== "unavailable" &&
    (data.canListPublicDirectory || data.canStampArIdentity);

  const refresh = useCallback(async () => {
    const res = await fetch(apiBase);
    if (!res.ok) return;
    setData((await res.json()) as AgentSolanaRegistrationPageData);
  }, [apiBase]);

  const handleRegister = async () => {
    if (registering) return;
    if (!data.canListPublicDirectory && !data.canStampArIdentity) return;
    if (data.status === "no_wallet" || data.status === "unavailable") return;
    if (data.status === "insufficient_balance") {
      openDashboardAgentWallet();
      showToast("Add about 0.01 SOL in this agent’s wallet, then tap Register again.", "info");
      return;
    }
    setRegistering(true);
    try {
      const res = await fetch(apiBase, { method: "POST" });
      const body = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: AgentSolanaRegistrationPageData;
        warning?: string;
        result?: { arIdentityPda?: string | null; directoryAsset?: string | null };
      };
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? "Registration failed");
      }
      if (body.data) {
        setData(body.data);
      } else {
        await refresh();
      }
      if (body.warning) {
        showToast(body.warning, "info");
      } else {
        const stamped = body.data?.registration?.arIdentityPda ?? body.result?.arIdentityPda;
        showToast(stamped ? "Registered on chain" : "Listed on-chain", "success");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Registration failed", "error");
      await refresh();
    } finally {
      setRegistering(false);
    }
  };

  const ctaLabel = isRegistered && data.canStampArIdentity ? "Stamp AgentRanking identity" : "Register";
  const registeredDateLabel = formatRegisteredDate(data.registration?.registeredAt);

  return (
    <div className="ui-dashboard-overview mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6 min-w-0">
      {data.chainReadDegraded ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <p>
            Solana RPC is busy — on-chain status may be incomplete. Wait about 30 seconds, then refresh.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-amber-100 hover:bg-amber-500/20 hover:text-white"
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        </div>
      ) : null}
      <section className="ui-overview-summary overflow-hidden rounded-xl">
        <header className="ui-overview-identity flex items-start gap-3 px-4 py-3.5 sm:px-5">
          <AgentAvatar image={data.agentImage} name={data.agentName} size="md" loading="eager" className="shrink-0 rounded-xl" />
          <div className="min-w-0">
            {isRegistered ? (
              <>
                <h1 className="text-xl font-semibold tracking-tight">Registered</h1>
                <p className="mt-1 text-sm text-[#aaa]">
                  Solana{registeredDateLabel ? ` · ${registeredDateLabel}` : ""}
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-semibold tracking-tight">Register</h1>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-[#aaa]">
                  {headerCopy(data)}
                </p>
              </>
            )}
          </div>
        </header>
        <div className="ui-overview-metrics grid grid-cols-3">
          <div className="ui-overview-metric px-3 py-3 sm:px-4">
            <p className="text-[10px] font-medium uppercase tracking-wider">Network</p>
            <p className="mt-0.5 text-sm font-semibold">Solana</p>
          </div>
          <div className="ui-overview-metric px-3 py-3 sm:px-4">
            <p className="text-[10px] font-medium uppercase tracking-wider">Network fee</p>
            <p className="mt-0.5 text-sm font-semibold">{data.networkFeeLabel}</p>
          </div>
          <div className="ui-overview-metric px-3 py-3 sm:px-4">
            <p className="text-[10px] font-medium uppercase tracking-wider">Platform fee</p>
            <p className="mt-0.5 text-sm font-semibold">Free</p>
          </div>
        </div>
      </section>

      <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
        <div className="ui-overview-panel-header px-5 py-4">
          <h2 className="text-sm font-semibold">Listing preview</h2>
        </div>
        <div className="flex items-start gap-4 px-5 py-4">
          <AgentAvatar image={data.agentImage} name={data.agentName} size="lg" className="shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium text-[#f1f1f1]">{data.agentName}</p>
            <p className="mt-1 text-sm leading-relaxed text-[#aaa]">
              {data.agentDescription || "No description yet. Add one on the agent profile before registering."}
            </p>
            {data.capabilities.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {data.capabilities.map((cap) => (
                  <span key={cap} className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-[#f1f1f1]">
                    {cap}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-[#aaa]">No capabilities tagged yet.</p>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <TrackCard
          title="Public directories"
          body={directoryTrackBody(data, directoryDone)}
          state={directoryDone ? "done" : "ready"}
        />
        <TrackCard
          title="AgentRanking identity"
          body={
            data.tokenMint
              ? "This agent has a token, so Register also stamps the official AR identity."
              : "Stamped when this agent has a token. Directory listing still works without one."
          }
          state={arState}
        />
      </div>

      {data.registration ? (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">{proofHeading}</h2>
          </div>
          <div className="space-y-2 px-5 py-4">
            {data.origin === "imported" && !directoryDone ? (
              <p className="text-sm leading-relaxed text-[#aaa]">
                This agent is already on-chain from import. Register still lists it on public directories.
              </p>
            ) : null}
            {data.registration.arIdentityPda ? (
              <CopyRow
                label="AgentRanking identity"
                value={data.registration.arIdentityPda}
                href={solscanAccountUrl(data.registration.arIdentityPda)}
              />
            ) : null}
            {data.registration.importedAddress ? (
              <CopyRow
                label={importedIdentityLabel(data.registration.importedKind)}
                value={data.registration.importedAddress}
                href={solscanAccountUrl(data.registration.importedAddress)}
              />
            ) : null}
            {data.registration.directoryPda ? (
              <CopyRow
                label="Directory listing"
                value={data.registration.directoryPda}
                href={solscanAccountUrl(data.registration.directoryPda)}
              />
            ) : null}
            {data.registration.directoryTx ? (
              <CopyRow
                label="Registration tx"
                value={data.registration.directoryTx}
                href={solscanTransactionUrl(data.registration.directoryTx)}
              />
            ) : null}
            {data.registration.arIdentityTx ? (
              <CopyRow
                label="Identity tx"
                value={data.registration.arIdentityTx}
                href={solscanTransactionUrl(data.registration.arIdentityTx)}
              />
            ) : null}
            <CopyRow label="Public profile" value={data.listingUri} href={data.listingUri} />
          </div>
          {data.canStampArIdentity && !data.canListPublicDirectory ? (
            <div className="flex justify-center px-5 pb-4">
              <Button
                className="gap-2 !bg-[#f1f1f1] !text-[#0f0f0f] hover:!bg-white"
                onClick={() => void handleRegister()}
                disabled={registering}
              >
                {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
                {registering ? "Stamping…" : "Stamp AgentRanking identity"}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {showRegisterPanel && (data.canListPublicDirectory || !data.registration) ? (
        <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
          <div className="ui-overview-panel-header px-5 py-4">
            <h2 className="text-sm font-semibold">Register</h2>
          </div>
          <div className="px-5 py-4">
            {data.status === "unavailable" ? (
              <p className="rounded-xl bg-[#212121] px-3 py-2.5 text-sm text-[#aaa]">
                On-chain registration is only available on Solana mainnet.
              </p>
            ) : null}
            {data.status === "no_wallet" ? (
              <p className="rounded-xl bg-[#212121] px-3 py-2.5 text-sm text-[#aaa]">
                This agent does not have a Solana wallet yet.
              </p>
            ) : null}
            {data.status === "insufficient_balance" ? (
              <p className="rounded-xl bg-[#212121] px-3 py-2.5 text-sm text-[#aaa]">
                This agent’s wallet is empty. Add about {data.requiredBalanceSol.toFixed(2)} SOL to it,
                then tap Register. The fee comes from that same agent wallet.
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-[#aaa]">
                AgentRanking does not charge. Solana takes about {data.networkFeeLabel} from this agent’s
                wallet.
              </p>
            )}

            <div className="mt-5 flex justify-center">
              <Button
                className="gap-2 !bg-[#f1f1f1] !text-[#0f0f0f] hover:!bg-white disabled:!bg-[#aaa] disabled:!text-[#212121]"
                onClick={() => void handleRegister()}
                disabled={registering || !canSubmitRegister}
              >
                {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
                {registering ? "Registering…" : ctaLabel}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <p className="text-xs leading-relaxed text-[#aaa]">
        Permanent on-chain. Paid from this agent&apos;s wallet. AgentRanking does not charge a platform fee.
      </p>
    </div>
  );
}
