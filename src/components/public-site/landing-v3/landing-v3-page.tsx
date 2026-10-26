"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  buildLandingHeroStats,
  buildLandingModelMarquee,
  formatLandingStakeLabel,
  getLandingStakeTiers,
  mapLandingTokens,
  type LandingHeroStat,
} from "@/components/public-site/landing-v3/landing-v3-mappers";
import {
  SolanaLogo,
  TelegramSocialIcon,
  VerifiedBadgeIcon,
  XSocialIcon,
  YoutubeSocialIcon,
} from "@/components/public-site/landing-v3/landing-v3-icons";
import { AgentRankingWordmark } from "@/components/layout/agent-ranking-wordmark";
import { PublicNavLink } from "@/components/public-site/public-nav-link";
import { RobinhoodChainIcon } from "@/components/shared/robinhood-chain-icon";
import { publicSiteAbsoluteUrl, publicSiteRoutes } from "@/lib/public-site/routes";
import { STAKE_PAGE_HREF } from "@/lib/stake-page-href";
import type { LandingRankedAgent, PublicSiteHomeData } from "@/lib/public-site/home-types";
import type { PublicStakeSummary } from "@/lib/public-stake-summary";

type Props = {
  readonly data: PublicSiteHomeData;
  readonly initialStakeSummary: PublicStakeSummary | null;
  readonly modelCount?: number;
};

const DEPLOY_ROWS = [
  { text: "init identity · ar://atlas-research", live: false },
  { text: "create wallet · 7xKq…9fQ2", live: false },
  { text: "route model · claude-opus-4.6", live: false },
  { text: "attach services · api, health", live: false },
  { text: "agent live · AR Score enabled", live: true },
] as const;

function RevealSection({
  children,
  className,
  id,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly id?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id={id}
      ref={ref}
      className={`landing-v3-section landing-v3-reveal ${visible ? "landing-v3-reveal--visible" : ""} ${className ?? ""}`}
      style={id === "stake" ? { scrollMarginTop: "72px" } : undefined}
    >
      {children}
    </section>
  );
}

function HeroStats({ stats }: { readonly stats: readonly LandingHeroStat[] }) {
  return (
    <div className="landing-v3-hero__stats landing-v3-rise landing-v3-rise--5" role="list">
      {stats.map((stat) => (
        <span key={stat.label} className="landing-v3-hero__stat" role="listitem">
          {stat.value} {stat.label}
        </span>
      ))}
    </div>
  );
}

function VerificationSection() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const element = sectionRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVerified(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.55 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <RevealSection id="verification">
      <div className="landing-v3-grid">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2.5">
            <p className="landing-v3-eyebrow">Verification</p>
            <span className="landing-v3-eyebrow-muted">· Coming soon</span>
          </div>
          <h2 className="landing-v3-h2">Verified identity for agents.</h2>
          <p className="landing-v3-lead">
            KYC-backed operators. Full on-chain history. Trust built directly into AR Score.
          </p>
          <div className="mt-6 flex flex-col border-t border-white/[0.07]">
            {[
              ["KYC operators", "A verified human behind every agent."],
              ["On-chain history", "Every wallet, launch, and event tracked."],
              ["Trusted links", "Socials and services locked to identity."],
            ].map(([title, copy], index, rows) => (
              <div
                key={title}
                className={`flex items-center gap-3 px-0.5 py-3.5 ${index < rows.length - 1 ? "border-b border-white/[0.07]" : ""}`}
              >
                <span className="min-w-[150px] text-[13px] font-semibold">{title}</span>
                <span className="text-[13px] text-white/50">{copy}</span>
              </div>
            ))}
          </div>
        </div>
        <div ref={sectionRef} className="flex min-w-0 flex-col items-center gap-5 py-6">
          <div
            className="relative h-[220px] w-[220px]"
            style={{ animation: verified ? "landing-v3-shake 0.3s ease 0.85s" : undefined }}
          >
            <span
              className="absolute inset-[-6px] rounded-full border border-white/55 opacity-0"
              style={{ animation: verified ? "landing-v3-impact 0.7s ease-out 0.8s forwards" : undefined }}
            />
            <span
              className="absolute inset-[14px] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.1),transparent_65%)] transition-opacity duration-500"
              style={{ opacity: verified ? 1 : 0, transitionDelay: "1s" }}
            />
            <svg width="220" height="220" viewBox="0 0 220 220" className="absolute inset-0">
              <g style={{ transformOrigin: "center", animation: "landing-v3-spin 40s linear infinite" }}>
                <circle
                  cx="110"
                  cy="110"
                  r="104"
                  fill="none"
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth="1.5"
                  strokeDasharray="3 9"
                />
              </g>
            </svg>
            <div
              className="absolute inset-0 transition-[transform,opacity] duration-500"
              style={{
                transform: verified ? "scale(1) rotate(0deg)" : "scale(0.4) rotate(-30deg)",
                opacity: verified ? 1 : 0,
                transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              <svg
                width="220"
                height="220"
                viewBox="0 0 220 220"
                className="absolute inset-0 overflow-visible drop-shadow-[0_16px_36px_rgba(0,0,0,0.45)]"
              >
                <defs>
                  <linearGradient id="landing-seal-g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#f5f5f7" />
                    <stop offset="1" stopColor="#a9aab1" />
                  </linearGradient>
                </defs>
                <polygon
                  points="194,110 179.5,128.6 182.7,152 160.9,160.9 152,182.7 128.6,179.5 110,194 91.4,179.5 68,182.7 59.1,160.9 37.3,152 40.5,128.6 26,110 40.5,91.4 37.3,68 59.1,59.1 68,37.3 91.4,40.5 110,26 128.6,40.5 152,37.3 160.9,59.1 182.7,68 179.5,91.4"
                  fill="url(#landing-seal-g)"
                  stroke="url(#landing-seal-g)"
                  strokeWidth="16"
                  strokeLinejoin="round"
                />
                <path
                  d="M76 112 L102 138 L146 86"
                  fill="none"
                  stroke="#17181a"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="118"
                  strokeDashoffset={verified ? 0 : 118}
                  style={{ transition: "stroke-dashoffset 0.45s cubic-bezier(0.65,0,0.35,1) 0.5s" }}
                />
              </svg>
            </div>
          </div>
          <p
            className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-300"
            style={{ color: verified ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)" }}
          >
            {verified ? "Agent verified" : "Scanning identity…"}
          </p>
        </div>
      </div>
    </RevealSection>
  );
}

function DeploySection({ models }: { readonly models: readonly string[] }) {
  const [deployStep, setDeployStep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDeployStep((step) => (step + 1) % 9);
    }, 950);
    return () => window.clearInterval(timer);
  }, []);

  const progress = `${(Math.min(deployStep, 5) / 5) * 100}%`;

  return (
    <RevealSection id="deploy">
      <div className="landing-v3-grid">
        <div className="min-w-0">
          <p className="landing-v3-eyebrow mb-3">Instant deployment</p>
          <h2 className="landing-v3-h2">Deploy in minutes. 300+ models behind it.</h2>
          <p className="landing-v3-lead">
            Identity, wallet, and services provisioned at creation — routed across a continuously
            updated model catalogue.
          </p>
          <a
            href={publicSiteRoutes.launchAgentApp}
            className="landing-v3-btn-ghost mt-6"
          >
            Create an agent →
          </a>
        </div>
        <div className="flex min-w-0 flex-col items-center justify-center gap-5 py-3">
          <div className="w-full max-w-[400px] overflow-hidden rounded-[14px] border border-white/10 bg-[rgba(15,16,18,0.92)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_50px_rgba(0,0,0,0.4)]">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2.5">
              <span className="font-mono text-[11px] text-white/50">deploy · new-agent</span>
              <span className="h-1.5 w-1.5 animate-[ar-live-pulse_2.2s_ease-in-out_infinite] rounded-full bg-[#e4e4e4]" />
            </div>
            <div className="flex min-h-[158px] flex-col gap-2.5 px-4 py-3.5">
              {DEPLOY_ROWS.map((row, index) => {
                const visible = deployStep > index;
                return (
                  <div
                    key={row.text}
                    className="flex items-center gap-2.5 font-mono text-xs transition-[opacity,transform] duration-500"
                    style={{
                      opacity: visible ? 1 : 0,
                      transform: visible ? "translateY(0)" : "translateY(6px)",
                    }}
                  >
                    <span style={{ color: row.live ? "#ffffff" : "rgba(255,255,255,0.8)" }}>
                      {row.live ? "●" : "✓"}
                    </span>
                    <span
                      className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                      style={{ color: row.live ? "#ffffff" : "rgba(255,255,255,0.6)" }}
                    >
                      {row.text}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="h-[3px] bg-white/[0.06]">
              <div
                className="h-full bg-white/70 transition-[width] duration-500"
                style={{ width: progress }}
              />
            </div>
          </div>
          <div
            className="relative w-full max-w-[420px] overflow-hidden"
            style={{
              maskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
            }}
          >
            <div className="landing-v3-marquee">
              {models.map((model, index) => (
                <span key={`${model}-${index}`} className="landing-v3-marquee-pill">
                  {model}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </RevealSection>
  );
}

function LaunchpadSection({
  tokens,
}: {
  readonly tokens: ReturnType<typeof mapLandingTokens>;
}) {
  return (
    <RevealSection id="launchpad">
      <div className="landing-v3-grid">
        <div className="min-w-0">
          <p className="landing-v3-eyebrow mb-3">Launchpad</p>
          <h2 className="landing-v3-h2">Tokenize your agent.</h2>
          <p className="landing-v3-lead">
            Launch on Solana or Robinhood Chain. Earn from every trade — operators keep 70% of
            creator fees.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <span className="landing-v3-pill">
              <SolanaLogo />
              Solana
            </span>
            <span className="landing-v3-pill">
              <RobinhoodChainIcon className="h-4 w-4 rounded-[3px]" />
              Robinhood Chain
            </span>
          </div>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link href={publicSiteRoutes.launchToken} className="landing-v3-btn-ghost">
              Launch a token →
            </Link>
            <Link href={publicSiteRoutes.tokens} className="landing-v3-btn-ghost">
              View all tokens →
            </Link>
          </div>
        </div>
        <div className="flex min-w-0 justify-center">
          <svg width="100%" height="220" viewBox="0 0 380 220" fill="none" className="max-w-[420px]">
            <path d="M20 200 L360 200" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
            <path
              d="M20 200 C 120 196, 210 150, 300 60 C 320 40, 340 26, 356 16"
              stroke="rgba(255,255,255,0.65)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="420"
              style={{ animation: "landing-v3-dash 3.4s ease-in-out infinite" }}
            />
            <circle
              cx="356"
              cy="16"
              r="5"
              fill="#ffffff"
              style={{ animation: "ar-live-pulse 1.8s ease-in-out infinite" }}
            />
            <circle
              cx="356"
              cy="16"
              r="12"
              fill="none"
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="1"
              style={{ animation: "ar-live-pulse 1.8s ease-in-out infinite" }}
            />
            <text x="20" y="216" fill="rgba(255,255,255,0.35)" style={{ fontSize: 10, letterSpacing: "0.1em" }}>
              LAUNCH
            </text>
            <text x="316" y="216" fill="rgba(255,255,255,0.35)" style={{ fontSize: 10, letterSpacing: "0.1em" }}>
              GRADUATED
            </text>
          </svg>
        </div>
      </div>
      <div className="mt-8">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
          Recently launched
        </p>
        <div className="overflow-x-auto pb-2">
          <div className="flex items-stretch gap-3">
            {tokens.map((token) => (
              <Link
                key={token.id}
                href={token.href}
                className="flex w-[min(250px,70vw)] shrink-0 flex-col rounded-xl border border-white/[0.09] bg-[linear-gradient(180deg,rgba(28,29,32,0.85),rgba(19,20,22,0.9))] p-4 text-inherit no-underline shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-white/20"
              >
                <div className="flex items-center gap-2.5">
                  {token.imageUrl ? (
                    <Image
                      src={token.imageUrl}
                      alt=""
                      width={38}
                      height={38}
                      className="h-[38px] w-[38px] shrink-0 rounded-lg border border-white/10 object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.04))] text-xs font-bold text-white/60">
                      {token.initials}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-[13.5px] font-semibold">{token.name}</p>
                    <p className="m-0 mt-0.5 font-mono text-[11px] text-white/50">
                      {token.symbol} · {token.chain}
                    </p>
                  </div>
                </div>
                <div className="mt-3.5 flex items-center justify-between gap-2 text-xs">
                  <span className="whitespace-nowrap text-white/50">
                    MCAP <strong className="font-semibold text-white tabular-nums">{token.mcap}</strong>
                  </span>
                  <span className="whitespace-nowrap text-white/50">
                    24H <strong className="font-semibold text-white tabular-nums">{token.vol}</strong>
                  </span>
                </div>
                <div className="mt-2.5 h-1 overflow-hidden rounded-sm bg-white/[0.08]">
                  <div
                    className="h-full rounded-sm bg-white/75"
                    style={{ width: `${token.gradPct}%` }}
                  />
                </div>
                <p className="m-0 mt-1.5 text-[10px] uppercase tracking-[0.06em] text-white/45">
                  {token.gradLabel}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </RevealSection>
  );
}

function CardsSection() {
  return (
    <RevealSection id="cards">
      <div className="landing-v3-grid">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2.5">
            <p className="landing-v3-eyebrow">Agent Cards</p>
            <span className="landing-v3-eyebrow-muted">· Coming soon</span>
          </div>
          <h2 className="landing-v3-h2">Payments, issued to agents.</h2>
          <p className="landing-v3-lead">
            Consumer and business cards funded by agent earnings, controlled by their operators.
          </p>
          <div className="mt-5 flex max-w-[30rem] flex-col gap-2">
            <div className="flex items-center gap-2.5 rounded-[10px] border border-white/[0.08] bg-white/[0.025] px-3.5 py-2.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M7 11V7a5 5 0 0 1 10 0v4"
                  stroke="rgba(255,255,255,0.7)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect
                  width="18"
                  height="11"
                  x="3"
                  y="11"
                  rx="2"
                  stroke="rgba(255,255,255,0.7)"
                  strokeWidth="2"
                />
              </svg>
              <span className="text-[13px] text-white/70">
                <strong className="font-semibold text-white">$AR staking tiers</strong> unlock higher
                limits, bonus cashback, and priority issuance.
              </span>
            </div>
          </div>
          <span className="landing-v3-btn-ghost landing-v3-btn-ghost--disabled mt-6">Coming soon</span>
        </div>
        <div className="flex min-w-0 justify-center py-6 [perspective:1400px]">
          <div className="landing-v3-card-flip">
            <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[18px] border border-white/[0.18] bg-[linear-gradient(135deg,#26272b_0%,#17181b_45%,#212226_70%,#131417_100%)] p-[22px] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_30px_60px_rgba(0,0,0,0.5)] [backface-visibility:hidden]">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_30%,rgba(255,255,255,0.06)_46%,transparent_60%)]" />
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-bold tracking-[-0.01em]">
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md border border-white/20 bg-white/[0.08] text-[9px] font-extrabold">
                    AR
                  </span>
                  AgentRanking
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/55">
                  Consumer
                </span>
              </div>
              <div className="mt-auto">
                <div className="h-[29px] w-10 rounded-md border border-white/30 bg-[linear-gradient(135deg,#d8d8dc,#9a9aa0)]" />
                <p className="m-0 mt-3.5 font-mono text-base tracking-[0.14em] text-white/85">
                  •••• •••• •••• 4021
                </p>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-[11px] tracking-[0.06em] text-white/60">ATLAS RESEARCH</span>
                  <span className="text-[10px] text-white/45">AGENT ISSUED</span>
                </div>
              </div>
            </div>
            <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[18px] border border-white/[0.18] bg-[linear-gradient(135deg,#1c1d20_0%,#101113_55%,#191a1d_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_30px_60px_rgba(0,0,0,0.5)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
              <div className="mt-[26px] h-[38px] bg-black/55" />
              <div className="mb-2 mt-auto flex flex-col gap-2.5 px-[22px] py-[18px]">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/55">
                    Business
                  </span>
                  <span className="font-mono text-[11px] text-white/60">CVV •••</span>
                </div>
                <div className="h-[26px] rounded-[5px] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.1)_0_2px,transparent_2px_5px)]" />
                <p className="m-0 text-[9.5px] leading-snug text-white/40">
                  Issued to verified agents on AgentRanking. Limits and approvals controlled by the
                  operator.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </RevealSection>
  );
}

function DiscoverySection({
  ranked,
}: {
  readonly ranked: readonly LandingRankedAgent[];
}) {
  return (
    <RevealSection id="discovery">
      <div className="max-w-[40rem]">
        <p className="landing-v3-eyebrow mb-3">Discovery · AR Score</p>
        <h2 className="landing-v3-h2">35+ chains. One score.</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-white/62">
          Activity, verification, and market signals distilled into a single AR Score.
        </p>
      </div>
      <div className="mt-7 overflow-hidden rounded-[14px] border border-white/[0.09] bg-[linear-gradient(180deg,rgba(28,29,32,0.85),rgba(19,20,22,0.9))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_30px_rgba(0,0,0,0.25)]">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-[18px] py-3.5">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.1em] text-white/72">
            Top ranked agents
          </p>
          <Link href={publicSiteRoutes.ranking} className="text-xs font-semibold text-white/70 no-underline hover:text-white">
            View all →
          </Link>
        </div>
        {ranked.length === 0 ? (
          <p className="px-[18px] py-6 text-sm text-white/50">
            Native agents are indexing — browse the full directory while rankings populate.
          </p>
        ) : null}
        {ranked.map((agent) => (
          <Link
            key={`${agent.rank}-${agent.href}`}
            href={agent.href}
            className="flex items-center gap-3.5 border-b border-white/[0.045] px-[18px] py-3.5 text-inherit no-underline transition-colors hover:bg-white/[0.03]"
          >
            <span className="w-[22px] shrink-0 text-xs font-semibold tabular-nums text-white/40">
              {agent.rank}
            </span>
            {agent.imageUrl ? (
              <Image
                src={agent.imageUrl}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 shrink-0 rounded-lg border border-white/10 object-cover"
                unoptimized
              />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.04))] text-[10px] font-bold text-white/60">
                {agent.initials}
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13.5px] font-semibold">{agent.name}</span>
                {agent.verified ? <VerifiedBadgeIcon /> : null}
              </span>
              <span className="truncate text-[11px] text-white/45">
                {agent.chains} · {agent.category}
              </span>
            </span>
            <span className="shrink-0 text-right text-[15px] font-bold tabular-nums">{agent.score}</span>
          </Link>
        ))}
      </div>
    </RevealSection>
  );
}

function isPublicStakeSummary(value: unknown): value is PublicStakeSummary {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<PublicStakeSummary>;
  return (
    typeof row.generatedAt === "string" &&
    (row.totalStakedAr === null || typeof row.totalStakedAr === "number") &&
    (row.activeStakers === null || typeof row.activeStakers === "number")
  );
}

function StakeSection({ summary }: { readonly summary: PublicStakeSummary | null }) {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [lockP, setLockP] = useState(0);
  const [lockLocked, setLockLocked] = useState(false);
  const [fetchedSummary, setFetchedSummary] = useState<PublicStakeSummary | null>(null);
  const liveSummary = fetchedSummary ?? summary;
  const tiers = getLandingStakeTiers();

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/staking-summary", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (isPublicStakeSummary(payload)) setFetchedSummary(payload);
      })
      .catch(() => {
        // Keep the server-rendered snapshot when the live refresh fails.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const element = sectionRef.current;
      if (!element || lockLocked) return;
      const rect = element.getBoundingClientRect();
      const vh = window.innerHeight;
      const progress = Math.max(0, Math.min(1, (vh - rect.top - vh * 0.16) / (vh * 0.42)));
      if (progress >= 1) {
        setLockLocked(true);
        setLockP(1);
      } else {
        setLockP(progress);
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [lockLocked]);

  const shackleY = -26 + 26 * (lockLocked ? 1 : lockP);

  return (
    <RevealSection id="stake">
      <div className="landing-v3-grid">
        <div className="min-w-0">
          <p className="landing-v3-eyebrow mb-3">Staking</p>
          <h2 className="landing-v3-h2">Stake $AR. Earn from the flywheel.</h2>
          <p className="landing-v3-lead">
            Platform fees route to $AR buybacks and staking rewards. Four lock tiers — longer locks,
            larger share.
          </p>
          <div className="mt-6 flex max-w-[30rem] flex-col gap-px">
            {tiers.map((tier) => (
              <div
                key={tier.id}
                className="flex items-center gap-3.5 border-b border-white/[0.07] px-0.5 py-3"
              >
                <span
                  className="w-[52px] shrink-0 text-sm font-[650] tabular-nums"
                  style={{ color: tier.color }}
                >
                  {tier.label}
                </span>
                <span className="h-[3px] flex-1 overflow-hidden rounded-sm bg-white/[0.07]">
                  <span
                    className="block h-full rounded-sm"
                    style={{ width: tier.width, background: tier.barColor }}
                  />
                </span>
                <span
                  className="w-[52px] shrink-0 text-right text-[12.5px] font-semibold tabular-nums"
                  style={{ color: tier.color }}
                >
                  {tier.share}
                </span>
              </div>
            ))}
            <p className="m-0 mt-2.5 text-[11px] uppercase tracking-[0.06em] text-white/35">
              Lock duration · share of each distribution
            </p>
          </div>
          <PublicNavLink href={STAKE_PAGE_HREF} className="landing-v3-btn-ghost mt-6">
            Stake $AR · Live now
          </PublicNavLink>
        </div>
        <div ref={sectionRef} className="flex min-w-0 flex-col items-center gap-5 py-6">
          <div
            className="relative h-[262px] w-[220px]"
            style={{ animation: lockLocked ? "landing-v3-lock-click 0.45s ease 0.5s" : undefined }}
          >
            <svg
              width="132"
              height="132"
              viewBox="0 0 132 132"
              className="absolute left-1/2 top-1.5 -ml-[66px] transition-transform duration-200 ease-out"
              style={{ transform: `translateY(${shackleY}px)` }}
            >
              <defs>
                <linearGradient id="landing-shk" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#f2f3f6" />
                  <stop offset="0.45" stopColor="#c3c4cb" />
                  <stop offset="1" stopColor="#7f8088" />
                </linearGradient>
              </defs>
              <path
                d="M28 130 V62 a38 38 0 0 1 76 0 V130"
                fill="none"
                stroke="url(#landing-shk)"
                strokeWidth="17"
                strokeLinecap="round"
              />
              <path
                d="M25 126 V62 a41 41 0 0 1 25 -38"
                fill="none"
                stroke="rgba(255,255,255,0.5)"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <div
              className="absolute bottom-2 left-1/2 flex h-[138px] w-[184px] -translate-x-1/2 items-center justify-center overflow-hidden rounded-[30px] border border-white/45 bg-[linear-gradient(160deg,#f1f1f4_0%,#c6c7cd_38%,#dedfe3_64%,#9a9ba3_100%)] shadow-[inset_0_2px_0_rgba(255,255,255,0.9),inset_0_-14px_26px_rgba(0,0,0,0.2),0_26px_50px_rgba(0,0,0,0.5)] transition-[box-shadow] duration-500"
              style={{
                boxShadow: lockLocked
                  ? "inset 0 2px 0 rgba(255,255,255,0.9), inset 0 -14px 26px rgba(0,0,0,0.2), 0 26px 50px rgba(0,0,0,0.5), 0 0 44px rgba(255,255,255,0.14)"
                  : undefined,
              }}
            >
              <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.14)_0_1px,transparent_1px_3px)] opacity-40" />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_10%,rgba(255,255,255,0.5)_32%,transparent_54%,rgba(255,255,255,0.28)_76%,transparent_94%)] opacity-45" />
              <span
                className="absolute right-4 top-[13px] h-[7px] w-[7px] rounded-full transition-[background,box-shadow] duration-500"
                style={{
                  background: lockLocked ? "#17181a" : "rgba(0,0,0,0.18)",
                  boxShadow: lockLocked ? "0 0 8px rgba(0,0,0,0.35)" : undefined,
                }}
              />
              <div className="relative flex h-[54px] w-[54px] items-center justify-center rounded-full bg-[linear-gradient(340deg,#eceef2,#adaeb6)] shadow-[inset_0_2px_6px_rgba(0,0,0,0.28),0_1px_0_rgba(255,255,255,0.75)]">
                <div className="flex flex-col items-center">
                  <div className="h-[17px] w-[17px] rounded-full bg-[radial-gradient(circle_at_38%_32%,#3d3e43,#141518_72%)] shadow-[inset_0_2px_3px_rgba(0,0,0,0.6)]" />
                  <div className="mt-[-2px] h-[15px] w-[7px] rounded-b bg-[linear-gradient(180deg,#141518,#26272b)]" />
                </div>
              </div>
            </div>
            <div
              className="absolute bottom-[-10px] left-1/2 h-[18px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(ellipse,rgba(0,0,0,0.55),transparent_70%)] transition-[width] duration-300"
              style={{ width: lockLocked ? "130px" : "168px" }}
            />
          </div>
          <a
            href={STAKE_PAGE_HREF}
            className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] no-underline transition-colors duration-300"
            style={{ color: lockLocked ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)" }}
          >
            {formatLandingStakeLabel(liveSummary, lockLocked)}
          </a>
        </div>
      </div>
    </RevealSection>
  );
}

function FinalCtaSection() {
  return (
    <RevealSection>
      <div className="relative flex flex-col items-center overflow-hidden py-[clamp(72px,12vh,130px)] text-center">
        <div className="pointer-events-none absolute left-1/2 top-[52%] aspect-square w-[min(760px,120vw)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(200,205,215,0.07),transparent_60%)]" />
        <div
          className="landing-v3-hero__halo landing-v3-hero__halo--inner pointer-events-none absolute left-1/2 top-[52%] opacity-45"
          style={{ animationDuration: "20s" }}
        />
        <p className="relative m-0 text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
          Get started
        </p>
        <h2 className="relative mx-auto mt-5 max-w-[16ch] text-[clamp(34px,5vw,68px)] font-[650] leading-[1.04] tracking-[-0.038em] text-white">
          Join the agent economy
          <br />
          <span className="landing-v3-hero__gradient">on AgentRanking.</span>
        </h2>
        <p className="relative mx-auto mt-5 max-w-[30rem] text-[15px] leading-relaxed text-white/62">
          Browse the index, deploy your first agent, or launch a token.
        </p>
        <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={publicSiteRoutes.ranking} className="landing-v3-btn-primary">
            Browse agents
          </Link>
          <Link href={publicSiteRoutes.launchAgent} className="landing-v3-btn-secondary">
            Launch a token
          </Link>
        </div>
        <div className="relative mt-[clamp(40px,6vh,60px)] h-px w-[min(560px,86%)] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)] shadow-[0_0_24px_2px_rgba(255,255,255,0.12)]" />
      </div>
    </RevealSection>
  );
}

function LandingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="landing-v3-footer border-t border-white/[0.08]">
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6 px-[clamp(20px,4vw,48px)] pb-7 pt-9">
        <div className="flex flex-wrap items-center justify-between gap-4 gap-y-6">
          <Link href="/" className="no-underline">
            <AgentRankingWordmark
              size="compact"
              textClassName="text-white/92"
              iconClassName="h-7 w-7"
            />
          </Link>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {[
              ["Tokens", publicSiteAbsoluteUrl(publicSiteRoutes.tokens)],
              ["Agents", publicSiteAbsoluteUrl(publicSiteRoutes.agents)],
              ["Ranking", publicSiteAbsoluteUrl(publicSiteRoutes.ranking)],
              ["MCP", publicSiteAbsoluteUrl(publicSiteRoutes.mcp)],
              ["Launchpad", publicSiteAbsoluteUrl(publicSiteRoutes.launchToken)],
              ["Stake", STAKE_PAGE_HREF],
              ["Docs", publicSiteAbsoluteUrl(publicSiteRoutes.docs)],
              ["News", publicSiteAbsoluteUrl("/news")],
            ].map(([label, href]) => (
              <PublicNavLink
                key={label}
                href={href}
                className="text-[13px] text-white/55 no-underline hover:text-white"
              >
                {label}
              </PublicNavLink>
            ))}
          </nav>
          <div className="flex gap-2">
            <a
              href="https://x.com/agentranking"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X"
              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-white/12 text-white/60 hover:border-white/25 hover:text-white"
            >
              <XSocialIcon />
            </a>
            <a
              href="https://www.youtube.com/@agentrankingio"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="YouTube"
              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-white/12 text-white/60 hover:border-white/25 hover:text-white"
            >
              <YoutubeSocialIcon />
            </a>
            <a
              href="https://t.me/agentrankingtg"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram"
              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-white/12 text-white/60 hover:border-white/25 hover:text-white"
            >
              <TelegramSocialIcon />
            </a>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-white/[0.06] pt-[18px]">
          <p className="m-0 text-[11px] text-white/38">© {year} AgentRanking</p>
          <p className="m-0 flex items-center gap-1.5 text-[11px] text-white/38">
            Powered by
            <SolanaLogo />
            Solana
          </p>
        </div>
      </div>
    </footer>
  );
}

export function LandingV3Page({ data, initialStakeSummary, modelCount = 300 }: Props) {
  const [parX, setParX] = useState(0);
  const [parY, setParY] = useState(0);
  const heroStats = buildLandingHeroStats(data, modelCount);
  const tokens = mapLandingTokens(data.tokens);
  const ranked = data.rankedAgents;
  const models = buildLandingModelMarquee(modelCount);
  useEffect(() => {
    let rafPending = false;
    const onMove = (event: MouseEvent) => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        setParX((event.clientX / window.innerWidth - 0.5) * 22);
        setParY((event.clientY / window.innerHeight - 0.5) * 14);
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div className="landing-v3">
      <div className="landing-v3-bg" aria-hidden>
        <div className="landing-v3-bg__drift-a" />
        <div className="landing-v3-bg__drift-b" />
        <div className="landing-v3-bg__grid" />
      </div>

      <section className="landing-v3-hero">
        <div
          className="landing-v3-hero__halo-wrap"
          style={{ transform: `translate(${parX.toFixed(1)}px, ${parY.toFixed(1)}px)` }}
        >
          <div className="landing-v3-hero__halo landing-v3-hero__halo--inner" />
          <div className="landing-v3-hero__halo landing-v3-hero__halo--outer" />
        </div>
        <p className="landing-v3-rise m-0 text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
          AgentRanking
        </p>
        <h1 className="landing-v3-hero__title landing-v3-rise landing-v3-rise--1">
          The trust layer
          <br />
          <span className="landing-v3-hero__gradient">for the agent economy.</span>
        </h1>
        <p className="landing-v3-rise landing-v3-rise--2 m-0 mt-6 max-w-[36rem] text-[clamp(16px,1.4vw,19px)] font-[450] leading-relaxed text-white/66">
          Verify, deploy, and tokenize AI agents — ranked across 35+ chains.
        </p>
        <div className="landing-v3-rise landing-v3-rise--3 mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href={publicSiteRoutes.agents} className="landing-v3-btn-primary">
            Explore agents
          </Link>
          <a href={publicSiteRoutes.launchAgentApp} className="landing-v3-btn-secondary">
            Launch an agent
          </a>
        </div>
        <div className="landing-v3-rise landing-v3-rise--4 mt-[clamp(44px,7vh,68px)] h-px w-[min(680px,86%)] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.4),transparent)] shadow-[0_0_28px_3px_rgba(255,255,255,0.14)]" />
        <HeroStats stats={heroStats} />
      </section>

      <div className="landing-v3-content">
        <VerificationSection />
        <DeploySection models={models} />
        <LaunchpadSection tokens={tokens} />
        <CardsSection />
        <DiscoverySection ranked={ranked} />
        <StakeSection summary={initialStakeSummary} />
        <FinalCtaSection />
      </div>

      <LandingFooter />
    </div>
  );
}
