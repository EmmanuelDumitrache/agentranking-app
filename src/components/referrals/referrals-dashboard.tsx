"use client";
import { useTransientState } from "@/hooks/use-transient-state";
import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import QRCode from "react-qr-code";
import {
  CheckCircle,
  Copy,
  Clock,
  Loader2,
  MousePointerClick,
  TrendingUp,
  Users,
} from "lucide-react";
import { ReferralsStatusPill } from "@/components/referrals/referrals-status-pill";
import { useQuery } from "@tanstack/react-query";
import { publicKeys } from "@/lib/query-keys/public";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { STAKE_PAGE_HREF } from "@/lib/stake-page-href";
import { getPublicSiteUrl } from "@/lib/site-url";
import { establishLaunchWalletSessionWithSigner } from "@/lib/launch-wallet-session/client";
function shareableReferralOrigin(): string {
  return getPublicSiteUrl();
}
function buildShareOnXUrl(referralCode: string): string {
  const link = `${shareableReferralOrigin()}/r/${referralCode}`;
  const text =
    `Get your AI agent verified on AgentRanking — I earn $AR when someone completes Agent Verification with my link:\n\n${link}\n\nAgent builders · KYA badge · @AgentRanking`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}
interface ConversionRow {
  id: string;
  orderNumber: string;
  productLabel: string;
  productType: string;
  orderUsd: number;
  commissionPct: number;
  commissionUsd: number;
  status: string;
  paidAt: string | null;
  referredLabel: string;
  createdAt: string;
}
interface StatsData {
  code: string | null;
  url: string | null;
  totalClicks: number;
  totalConversions: number;
  pendingUsd: number;
  approvedUsd: number;
  paidUsd: number;
  conversions: ConversionRow[];
  setupWarning?: string;
}
type StatsApiPayload = StatsData | { error?: string; detail?: string };
class WalletSessionRequiredError extends Error {}
export function ReferralsDashboard() {
  const { publicKey, signMessage } = useWallet();
  const [copied, setCopied] = useTransientState(false, 2000);
  const [ensuring, setEnsuring] = useState(false);
  const [codeSaving, setCodeSaving] = useState(false);
  const [verifyingWallet, setVerifyingWallet] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [emptyDraft, setEmptyDraft] = useState("");
  const wallet = publicKey?.toBase58() ?? null;
  const origin = globalThis.window?.location.origin ?? "https://agentranking.io";
  const displayLinkBase = shareableReferralOrigin();
  const loadStats = useCallback(async (signal: AbortSignal): Promise<StatsData | null> => {
    if (!wallet) return null;
    const res = await fetch(`/api/referrals/my-stats?wallet=${encodeURIComponent(wallet)}`, { signal });
    const data = (await res.json()) as StatsApiPayload;
    if (res.status === 401 || res.status === 403) {
      throw new WalletSessionRequiredError(
        "Verify this wallet with a signature before viewing private referral data.",
      );
    }
    if (!res.ok || ("error" in data && typeof data.error === "string")) {
      const errBody = data as { error?: string; detail?: string };
      const base = typeof errBody.error === "string"
        ? errBody.error
        : `Could not load referral stats (${res.status}).`;
      const detail = typeof errBody.detail === "string" && errBody.detail.trim()
        ? ` — ${errBody.detail.trim()}`
        : "";
      throw new Error(`${base}${detail}`);
    }
    return data as StatsData;
  }, [wallet]);
  const statsQuery = useQuery({
    queryKey: [...publicKeys.referralStats(), wallet ?? "disconnected"],
    queryFn: ({ signal }) => loadStats(signal),
    enabled: Boolean(wallet),
  });
  const stats = statsQuery.data;
  const statsError = statsQuery.error?.message ?? null;
  const walletSessionRequired = statsQuery.error instanceof WalletSessionRequiredError;
  const loading = statsQuery.isPending;
  const { refetch: refetchStats } = statsQuery;
  const [codeDraft, setCodeDraft] = useSourceDraft(stats?.code ?? null, stats?.code ?? "");
  const verifyWallet = useCallback(async () => {
    if (!wallet || !signMessage) {
      setCodeError("This wallet does not support message signing.");
      return;
    }
    setVerifyingWallet(true);
    setCodeError(null);
    try {
      await establishLaunchWalletSessionWithSigner({
        chain: "solana",
        wallet,
        signMessage: async (message) => {
          const signature = await signMessage(new TextEncoder().encode(message));
          return bs58.encode(signature);
        },
      });
      void refetchStats();
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : "Wallet verification failed.");
    } finally {
      setVerifyingWallet(false);
    }
  }, [refetchStats, signMessage, wallet]);
  const ensureCode = useCallback(
    async (w: string) => {
      setEnsuring(true);
      try {
        await fetch("/api/referrals/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "ensure_code", ownerWallet: w, destination: STAKE_PAGE_HREF }),
        });
        void refetchStats();
      } finally {
        setEnsuring(false);
      }
    },
    [refetchStats],
  );
  const saveCustomCode = useCallback(
    async (w: string, nextRaw: string) => {
      setCodeSaving(true);
      setCodeError(null);
      try {
        const res = await fetch("/api/referrals/set-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerWallet: w, code: nextRaw }),
        });
        const data = (await res.json()) as { error?: string; code?: string };
        if (!res.ok) {
          setCodeError(data.error ?? "Could not save code");
          return;
        }
        void refetchStats();
      } catch {
        setCodeError("Could not save code");
      } finally {
        setCodeSaving(false);
      }
    },
    [refetchStats],
  );
  if (!wallet) {
    return (
      <div className="referrals-panel referrals-connect-panel">
        <div className="referrals-connect-copy">
          <p className="referrals-connect-title">Connect wallet</p>
          <p className="referrals-connect-meta">
            Use the Solana wallet that holds your $AR to generate a link and track earnings.
          </p>
        </div>
        <div className="referrals-wallet-wrap">
          <WalletMultiButton />
        </div>
      </div>
    );
  }
  if (loading || ensuring) {
    return (
      <div className="referrals-directory-state" role="status" aria-busy="true">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Loading your referral hub…
      </div>
    );
  }
  if (walletSessionRequired) {
    return (
      <div className="referrals-panel referrals-create-panel">
        <h2 className="referrals-panel-title">Verify wallet ownership</h2>
        <p className="referrals-panel-subcopy">
          Sign a non-transaction message to view commission history and manage this wallet&apos;s referral code.
        </p>
        {codeError ? <p className="referrals-field-error">{codeError}</p> : null}
        <button
          type="button"
          className="ar-btn ar-btn-primary"
          disabled={verifyingWallet}
          onClick={() => void verifyWallet()}
        >
          {verifyingWallet ? "Verifying…" : "Verify wallet"}
        </button>
      </div>
    );
  }
  if (statsError) {
    return (
      <div className="referrals-error-panel">
        <p className="referrals-error-title">Could not load your referral hub</p>
        <p className="referrals-error-copy">{statsError}</p>
        <p className="referrals-error-hint">
          If you created a code in production, point local dev at the same database and run{" "}
          <code>pnpm exec prisma migrate dev</code>.
        </p>
        <button
          type="button"
          className="ar-btn ar-btn-secondary"
          onClick={() => void refetchStats()}
        >
          Retry
        </button>
      </div>
    );
  }
  if (stats && !stats.code) {
    return (
      <div className="referrals-panel referrals-create-panel">
        {stats.setupWarning ? (
          <div className="referrals-notice">{stats.setupWarning}</div>
        ) : null}
        <h2 className="referrals-panel-title">Create your referral link</h2>
        <p className="referrals-panel-subcopy">
          Pick a short code (letters, numbers, hyphens) or generate a random one.
        </p>
        <label htmlFor="ref-empty-code" className="referrals-field-label">
          Custom code
        </label>
        <input
          id="ref-empty-code"
          type="text"
          value={emptyDraft}
          onChange={(e) => setEmptyDraft(e.target.value)}
          placeholder="e.g. my-agent or verify-team"
          className="referrals-input"
          autoComplete="off"
        />
        {codeError ? <p className="referrals-field-error">{codeError}</p> : null}
        <div className="referrals-create-actions">
          <button
            type="button"
            disabled={codeSaving || ensuring || !emptyDraft.trim()}
            onClick={() => wallet && void saveCustomCode(wallet, emptyDraft)}
            className="ar-btn ar-btn-primary"
          >
            {codeSaving ? "Saving…" : "Save custom code"}
          </button>
          <button
            type="button"
            disabled={codeSaving || ensuring}
            onClick={() => wallet && void ensureCode(wallet)}
            className="ar-btn ar-btn-secondary"
          >
            {ensuring ? "…" : "Auto-generate"}
          </button>
        </div>
      </div>
    );
  }
  if (!stats?.code) return null;
  const publicReferralUrl = `${displayLinkBase}/r/${stats.code}`;
  function copyLink() {
    void navigator.clipboard.writeText(publicReferralUrl).then(() => {
      setCopied(true);
    });
  }
  return (
    <div className="referrals-dashboard">
      <div className="referrals-panel referrals-link-panel">
        <div className="referrals-link-layout">
          <div className="referrals-link-main">
            <div>
              <p className="referrals-field-label">Your referral code</p>
              <code className="referrals-code">{stats.code}</code>
            </div>
            <div className="referrals-custom-code">
              <label htmlFor="ref-custom-code" className="referrals-field-label">
                Customize code
              </label>
              <div className="referrals-inline-field">
                <input
                  id="ref-custom-code"
                  type="text"
                  value={codeDraft}
                  onChange={(e) => setCodeDraft(e.target.value)}
                  placeholder="letters, numbers, hyphens"
                  className="referrals-input"
                  autoComplete="off"
                />
                <button
                  type="button"
                  disabled={codeSaving || !wallet || codeDraft.trim().toLowerCase() === stats.code}
                  onClick={() => wallet && void saveCustomCode(wallet, codeDraft)}
                  className="ar-btn ar-btn-secondary referrals-save-btn"
                >
                  {codeSaving ? "Saving…" : "Save"}
                </button>
              </div>
              {codeError ? <p className="referrals-field-error">{codeError}</p> : null}
              <p className="referrals-field-hint">
                Changing your code updates your link and QR. Old links stop working.
              </p>
            </div>
            <div>
              <p className="referrals-field-label">Your referral link</p>
              <div className="referrals-link-row">
                <span className="referrals-link-url">{publicReferralUrl}</span>
                <button
                  type="button"
                  onClick={copyLink}
                  className="referrals-copy-btn"
                  aria-label="Copy link"
                >
                  {copied ? (
                    <CheckCircle className="h-4 w-4 text-[var(--ar-success)]" aria-hidden />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
              {origin !== displayLinkBase ? (
                <p className="referrals-field-hint">
                  Sharing uses <span className="referrals-mono">{displayLinkBase}</span> so links work
                  for everyone.
                </p>
              ) : null}
              <a
                href={buildShareOnXUrl(stats.code)}
                target="_blank"
                rel="noopener noreferrer"
                className="ar-btn ar-btn-secondary referrals-share-btn"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" aria-hidden fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Share on X
              </a>
              <p className="referrals-field-hint">
                Purchases within 30 days of a click are attributed to you.
              </p>
            </div>
          </div>
          <div className="referrals-qr-wrap">
            <div className="referrals-qr-box">
              <QRCode value={publicReferralUrl} size={112} />
            </div>
            <p className="referrals-field-hint">Scan to share</p>
          </div>
        </div>
      </div>
      <dl className="referrals-stats">
        {[
          { icon: MousePointerClick, label: "Total clicks", value: String(stats.totalClicks) },
          { icon: Users, label: "Conversions", value: String(stats.totalConversions) },
          { icon: Clock, label: "Pending (USD)", value: `$${stats.pendingUsd.toFixed(2)}` },
          { icon: TrendingUp, label: "Paid out (USD)", value: `$${stats.paidUsd.toFixed(2)}` },
        ].map((item) => (
          <div key={item.label} className="referrals-stat">
            <item.icon className="referrals-stat-icon" aria-hidden />
            <dt className="referrals-stat-label">{item.label}</dt>
            <dd className="referrals-stat-value">{item.value}</dd>
          </div>
        ))}
      </dl>
      {stats.approvedUsd > 0 ? (
        <div className="referrals-notice referrals-notice--info">
          <strong>${stats.approvedUsd.toFixed(2)}</strong> approved and awaiting payout — the team will
          send $AR to your wallet soon.
        </div>
      ) : null}
      <section className="referrals-conversions">
        <header className="referrals-conversions-header">
          <h2 className="referrals-section-title">Conversions & commissions</h2>
          <span className="referrals-conversions-count">{stats.conversions.length} total</span>
        </header>
        {stats.conversions.length === 0 ? (
          <div className="referrals-conversions-empty">
            No conversions yet. Share your link to start earning.
          </div>
        ) : (
          <div className="referrals-table-wrap">
            <div className="referrals-table-scroll">
              <table className="referrals-table">
                <thead>
                  <tr>
                    {["Date", "Product", "Order #", "Order USD", "Commission", "Referred", "Status"].map(
                      (heading) => (
                        <th key={heading} scope="col" className="referrals-th">
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {stats.conversions.map((row) => (
                    <tr key={row.id} className="referrals-row">
                      <td className="referrals-td referrals-td--meta">
                        {new Date(row.createdAt).toLocaleDateString()}
                      </td>
                      <td className="referrals-td">{row.productLabel}</td>
                      <td className="referrals-td referrals-td--mono">{row.orderNumber || "—"}</td>
                      <td className="referrals-td referrals-td--num">${row.orderUsd.toFixed(2)}</td>
                      <td className="referrals-td referrals-td--commission">
                        ${row.commissionUsd.toFixed(2)}
                        <span className="referrals-commission-pct">
                          ({Math.round(row.commissionPct * 100)}%)
                        </span>
                      </td>
                      <td className="referrals-td referrals-td--mono">{row.referredLabel}</td>
                      <td className="referrals-td">
                        <ReferralsStatusPill status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
