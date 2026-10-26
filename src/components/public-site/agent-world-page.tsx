"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { Building2, Check, ChevronDown, ChevronUp, Server, ShieldCheck, Zap } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import styles from "@/components/public-site/agent-world.module.css";
import { CardSocialIcons } from "@/components/public-site/card-social-icons";
import { RegisteredTick } from "@/components/shared/registered-badge";
import { VerifiedTick } from "@/components/shared/verified-badge";
import {
  corpusTiersForWorldFilters,
  type AgentWorldFilterKey,
} from "@/lib/public-site/agent-world-layout";
import {
  AGENT_WORLD_AR_CHAIN_ID,
  type AgentWorldAgentPreview,
  type AgentWorldSnapshot,
} from "@/lib/public-site/world-types";
import { resolveChainIconUrl } from "@/lib/chain-icon-url";
import { publicSiteRoutes } from "@/lib/public-site/routes";
import { cn } from "@/lib/utils";

const AgentWorldScene = dynamic(
  () =>
    import("@/components/public-site/agent-world-scene").then((mod) => mod.AgentWorldScene),
  {
    ssr: false,
    loading: () => <WorldBootSplash />,
  },
);

type Props = {
  readonly snapshot: AgentWorldSnapshot;
};

const countFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const PREVIEW_WIDTH = 300;
const PREVIEW_HEIGHT = 196;
const PREVIEW_SIDEBAR = 184;
const PREVIEW_PAD = 12;

function WorldBootSplash() {
  return (
    <div className={styles.bootSplash} aria-hidden>
      <Image src="/ar-mark.png" alt="" width={36} height={36} className={styles.bootMark} />
      <span>Loading AR World</span>
    </div>
  );
}

function WorldIntroBrand({ compact = false }: { readonly compact?: boolean }) {
  const size = compact ? 40 : 72;
  return (
    <span className={cn(styles.introBrand, compact && styles.introBrandCompact)}>
      <Image
        src="/ar-mark.png"
        alt=""
        width={size}
        height={size}
        className={styles.introLogo}
        priority
      />
      <span className={styles.introBrandCopy}>
        <span className={styles.introBrandName}>AgentRanking</span>
        <span className={styles.introBrandSub}>World</span>
      </span>
    </span>
  );
}

function WorldIntroOverlay({
  indexedCount,
  liveCount,
  onDismiss,
}: {
  readonly indexedCount: number;
  readonly liveCount: number;
  readonly onDismiss: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<"boot" | "stats">(reducedMotion ? "stats" : "boot");

  const handleIntroClick = () => {
    if (phase === "boot") {
      setPhase("stats");
      return;
    }
    onDismiss();
  };

  return (
    <button
      type="button"
      className={cn(styles.intro, phase === "boot" && styles.introBootPhase)}
      onClick={handleIntroClick}
      aria-label="Enter AgentRanking World"
    >
      <span className={styles.introGlow} />
      {phase === "boot" ? (
        <span className={styles.introBoot}>
          <WorldIntroBrand />
          <span className={styles.introBootTag}>Mapping the agent economy</span>
        </span>
      ) : (
        <span className={styles.introStats}>
          <span className={styles.introStatBlock}>
            <span className={styles.introCount}>{countFormatter.format(indexedCount)}</span>
            <span className={styles.introCaption}>agents indexed across chains</span>
          </span>
          <span className={styles.introStatBlock}>
            <span className={cn(styles.introCount, styles.introLive)}>
              {countFormatter.format(liveCount)}
            </span>
            <span className={styles.introCaption}>live on AgentRanking</span>
          </span>
        </span>
      )}
      <span className={styles.introHint}>
        {phase === "boot" ? "Tap to continue" : "Tap to enter the map"}
      </span>
    </button>
  );
}

function WorldHudPanel({
  title,
  collapsed,
  onToggleCollapsed,
  className,
  children,
}: {
  readonly title: string;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        className={cn(styles.panelCollapsedChip, className)}
        onClick={onToggleCollapsed}
        aria-expanded={false}
        aria-label={`Expand ${title}`}
      >
        <span>{title}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
      </button>
    );
  }

  return (
    <div className={cn(styles.panel, className)}>
      <div className={styles.panelHeaderRow}>
        <div className={styles.panelHeader}>{title}</div>
        <button
          type="button"
          className={styles.panelCollapseBtn}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapsed();
          }}
          aria-expanded
          aria-label={`Collapse ${title}`}
        >
          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {children}
    </div>
  );
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "AR";
}

function clampPreviewPosition(cursor: { readonly x: number; readonly y: number }) {
  if (typeof window === "undefined") return { left: cursor.x + 16, top: cursor.y + 16 };
  const maxLeft = window.innerWidth - PREVIEW_WIDTH - PREVIEW_SIDEBAR;
  const maxTop = window.innerHeight - PREVIEW_HEIGHT - PREVIEW_PAD;
  let left = cursor.x + 16;
  let top = cursor.y + 16;
  if (left > maxLeft) left = cursor.x - PREVIEW_WIDTH - 14;
  if (left < PREVIEW_PAD) left = PREVIEW_PAD;
  if (top > maxTop) top = cursor.y - PREVIEW_HEIGHT - 12;
  if (top < 64) top = 64;
  return { left, top };
}

function FilterGlyph({ kind }: { readonly kind: AgentWorldFilterKey }) {
  switch (kind) {
    case "verified":
      return <VerifiedTick size="sm" />;
    case "registered":
      return <RegisteredTick size="sm" />;
    case "kyc":
      return <ShieldCheck className="h-3 w-3" strokeWidth={2.25} />;
    case "business":
      return <Building2 className="h-3 w-3" strokeWidth={2.25} />;
    case "live":
      return <span className={styles.previewLiveDot} />;
    case "x402":
      return <Zap className="h-3 w-3" strokeWidth={2.25} />;
    case "mcp":
      return <Server className="h-3 w-3" strokeWidth={2.25} />;
    case "dead":
      return <span className={cn(styles.previewLiveDot, styles.previewLiveDotOff)} />;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled world filter: ${exhaustive}`);
    }
  }
}

type WorldFilterRow = {
  readonly key: AgentWorldFilterKey;
  readonly label: string;
  readonly hint: string;
  readonly count?: number;
  readonly nested?: boolean;
  readonly soon?: boolean;
};

function WorldFilterCheck({
  row,
  active,
  onToggle,
}: {
  readonly row: WorldFilterRow;
  readonly active: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(styles.tierButton, row.nested && styles.tierButtonNested, active && styles.tierButtonActive)}
      onClick={onToggle}
      aria-pressed={active}
    >
      <span className={cn(styles.filterCheck, active && styles.filterCheckOn)}>
        {active ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
      </span>
      <span className={styles.filterIcon}>
        <FilterGlyph kind={row.key} />
      </span>
      <span className={styles.tierCopy}>
        <span className={styles.tierTitle}>{row.label}</span>
        {row.soon ? <span className={styles.filterSoon}>Soon</span> : null}
        {row.count != null ? (
          <span className={styles.tierCount}>{countFormatter.format(row.count)}</span>
        ) : null}
      </span>
      <span className={styles.tierHint}>{row.hint}</span>
    </button>
  );
}

function WorldArScoreRing({ score }: { readonly score: number }) {
  const clamped = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  const radius = 11;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" className="shrink-0" aria-hidden>
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        stroke="var(--app-border, rgb(255 255 255 / 0.14))"
        strokeWidth="2.5"
      />
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 16 16)"
      />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        fill="currentColor"
        style={{ fontSize: "9px", fontWeight: 650, fontFamily: "var(--font-mono, ui-monospace)" }}
      >
        {Number.isFinite(score) ? clamped : "—"}
      </text>
    </svg>
  );
}

function AgentWorldHoverCard({ preview }: { readonly preview: AgentWorldAgentPreview }) {
  return (
    <div className={styles.previewCard}>
      <CardSocialIcons socials={preview.socials} className={styles.previewSocials} />
      <a
        href={preview.href}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.previewMain}
      >
        <span className={styles.previewTop}>
          {preview.image ? (
            <Image
              src={preview.image}
              alt=""
              width={40}
              height={40}
              className={styles.previewImage}
              unoptimized
            />
          ) : (
            <span className={styles.previewInitials}>{initialsFromName(preview.name)}</span>
          )}
          <span className={styles.previewIdentity}>
            <span className={styles.previewNameRow}>
              <span className={styles.previewName}>{preview.name}</span>
              <span className={styles.previewMarks}>
                {preview.verified ? <VerifiedTick size="sm" /> : null}
                {preview.registered ? <RegisteredTick size="sm" /> : null}
              </span>
            </span>
            <span className={styles.previewMeta}>
              <span
                className={cn(styles.previewLiveDot, !preview.live && styles.previewLiveDotOff)}
                aria-hidden
              />
              {preview.chainShortName} · {preview.live ? "Live" : "Inactive"}
            </span>
          </span>
        </span>
        {preview.description ? (
          <span className={styles.previewDescription}>{preview.description}</span>
        ) : null}
        <span className={styles.previewFooter}>
          <span className={styles.previewScore}>
            <WorldArScoreRing score={preview.score} />
            <span className={styles.previewScoreCopy}>
              AR
              <br />
              Score
            </span>
          </span>
          <span className={styles.previewCta}>View agent →</span>
        </span>
      </a>
    </div>
  );
}

export function AgentWorldPageClient({ snapshot }: Props) {
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
  const [selectedFilters, setSelectedFilters] = useState<ReadonlySet<AgentWorldFilterKey>>(
    () => new Set(),
  );
  const [hoveredPreview, setHoveredPreview] = useState<AgentWorldAgentPreview | null>(null);
  const [cursor, setCursor] = useState({ x: 24, y: 120 });
  const [introOpen, setIntroOpen] = useState(true);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [chainsCollapsed, setChainsCollapsed] = useState(false);
  const previewLocked = useRef(false);
  const dismissIntro = useCallback(() => setIntroOpen(false), []);

  const liveCount = useMemo(() => {
    const verified = snapshot.corpusTiers.find((tier) => tier.key === "verified")?.count ?? 0;
    const listed = snapshot.corpusTiers.find((tier) => tier.key === "listed")?.count ?? 0;
    return verified + listed;
  }, [snapshot.corpusTiers]);

  const registeredCount = useMemo(() => {
    return Math.max(0, snapshot.totals.indexedAgents - snapshot.totals.deadOrSpamAgents);
  }, [snapshot.totals.deadOrSpamAgents, snapshot.totals.indexedAgents]);

  const activeTiers = useMemo(
    () => corpusTiersForWorldFilters(selectedFilters),
    [selectedFilters],
  );

  const filterRows = useMemo<WorldFilterRow[]>(
    () => [
      {
        key: "verified",
        label: "Verified",
        hint: "AgentRanking verified — eligible for ranked discovery.",
        count: snapshot.totals.verifiedAgents,
      },
      {
        key: "kyc",
        label: "KYC",
        hint: "Operator passed KYC. Rolling out with account verification.",
        nested: true,
        soon: true,
      },
      {
        key: "business",
        label: "Business",
        hint: "KYB / business-verified operators. Rolling out with business accounts.",
        nested: true,
        soon: true,
      },
      {
        key: "registered",
        label: "Registered",
        hint: "On-chain ERC-8004 or Solana directory registration.",
        count: registeredCount,
      },
      {
        key: "live",
        label: "Live",
        hint: "Active listed agents answering in the index.",
        count: liveCount,
      },
      {
        key: "x402",
        label: "x402",
        hint: "Agents with x402 payment support.",
        count: snapshot.totals.x402Agents,
      },
      {
        key: "mcp",
        label: "MCP",
        hint: "Agents exposing an MCP endpoint.",
        count: snapshot.totals.mcpAgents,
      },
      {
        key: "dead",
        label: "Dead",
        hint: "Inactive, empty, blocked, or junk registrations.",
        count: snapshot.totals.deadOrSpamAgents,
      },
    ],
    [liveCount, registeredCount, snapshot.totals],
  );

  const previewPosition = hoveredPreview ? clampPreviewPosition(cursor) : null;

  const toggleFilter = (key: AgentWorldFilterKey) => {
    setSelectedFilters((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
        if (key === "verified") {
          next.delete("kyc");
          next.delete("business");
        }
      } else {
        next.add(key);
        if (key === "kyc" || key === "business") next.add("verified");
      }
      return next;
    });
  };

  return (
    <div className={styles.shell}>
      {introOpen ? (
        <WorldIntroOverlay
          indexedCount={snapshot.totals.indexedAgents}
          liveCount={liveCount}
          onDismiss={dismissIntro}
        />
      ) : null}

      <div className={cn(styles.topBar, introOpen && styles.chromeHidden)}>
        <Link href="/" className={styles.brandLink}>
          <Image
            src="/ar-mark.png"
            alt=""
            width={22}
            height={22}
            className={styles.brandMark}
          />
          <span>
            <span className={styles.brandAr}>AR</span> World
          </span>
        </Link>
        <div className={styles.topLinks}>
          <Link href="/" className={styles.topLink}>
            Exit
          </Link>
        </div>
      </div>

      <div className={styles.canvasLayer}>
        <AgentWorldScene
          snapshot={snapshot}
          selectedChainId={selectedChainId}
          activeTiers={activeTiers}
          onSelectChain={setSelectedChainId}
          onCursorMove={setCursor}
          onHoverPreview={(preview) => {
            if (preview) setHoveredPreview(preview);
            else if (!previewLocked.current) setHoveredPreview(null);
          }}
        />
      </div>

      {hoveredPreview && previewPosition && !introOpen ? (
        <div
          className={styles.previewFollow}
          style={{ left: previewPosition.left, top: previewPosition.top }}
          onMouseEnter={() => {
            previewLocked.current = true;
          }}
          onMouseLeave={() => {
            previewLocked.current = false;
            setHoveredPreview(null);
          }}
        >
          <AgentWorldHoverCard preview={hoveredPreview} />
        </div>
      ) : null}

      <div className={cn(styles.hud, introOpen && styles.chromeHidden)}>
        <div className={styles.hudTop}>
          <WorldHudPanel
            title="Filters"
            collapsed={filtersCollapsed}
            onToggleCollapsed={() => setFiltersCollapsed((value) => !value)}
            className={styles.qualityPanel}
          >
            <div className={styles.panelBody}>
              {filterRows.map((row) => (
                <WorldFilterCheck
                  key={row.key}
                  row={row}
                  active={selectedFilters.has(row.key)}
                  onToggle={() => toggleFilter(row.key)}
                />
              ))}
            </div>
          </WorldHudPanel>

          <WorldHudPanel
            title="Chains"
            collapsed={chainsCollapsed}
            onToggleCollapsed={() => setChainsCollapsed((value) => !value)}
            className={styles.chainPanel}
          >
            <div className={cn(styles.panelBody, styles.chainList)}>
              <button
                type="button"
                className={cn(styles.chainRow, selectedChainId == null && styles.chainRowActive)}
                onClick={() => setSelectedChainId(null)}
              >
                <span className={styles.chainName}>All chains</span>
                <span className={styles.chainCount}>{snapshot.totals.totalChains}</span>
              </button>
              <button
                type="button"
                className={cn(
                  styles.chainRow,
                  selectedChainId === AGENT_WORLD_AR_CHAIN_ID && styles.chainRowActive,
                )}
                onClick={() =>
                  setSelectedChainId(
                    selectedChainId === AGENT_WORLD_AR_CHAIN_ID ? null : AGENT_WORLD_AR_CHAIN_ID,
                  )
                }
              >
                <Image
                  src="/ar-mark.png"
                  alt=""
                  width={14}
                  height={14}
                  className={cn(styles.chainIcon, styles.arChainIcon)}
                />
                <span className={styles.chainName}>AR</span>
                <span className={styles.chainCount}>
                  {countFormatter.format(snapshot.arCluster.listedCount)}
                </span>
              </button>
              {snapshot.chains.map((chain) => {
                const icon = resolveChainIconUrl(chain.chainId, chain.icon);
                const active = selectedChainId === chain.chainId;
                return (
                  <button
                    key={chain.chainId}
                    type="button"
                    className={cn(styles.chainRow, active && styles.chainRowActive)}
                    onClick={() => setSelectedChainId(active ? null : chain.chainId)}
                  >
                    {icon ? (
                      <Image
                        src={icon}
                        alt=""
                        width={14}
                        height={14}
                        className={styles.chainIcon}
                        unoptimized
                      />
                    ) : (
                      <span className={styles.chainIcon} />
                    )}
                    <span className={styles.chainName}>{chain.name}</span>
                    <span className={styles.chainCount}>
                      {countFormatter.format(chain.listedCount)}
                    </span>
                  </button>
                );
              })}
            </div>
          </WorldHudPanel>
        </div>

        <div>
          <div className={styles.bottomBar}>
            <div className={styles.statPill}>
              <span>
                <span className={styles.statValue}>
                  {countFormatter.format(snapshot.totals.indexedAgents)}
                </span>{" "}
                indexed
              </span>
              <span>
                <span className={styles.statValue}>{countFormatter.format(liveCount)}</span> live
              </span>
            </div>
            <Link href={publicSiteRoutes.agents} className={styles.primaryButton}>
              Browse
            </Link>
          </div>
          <p className={styles.helpText}>
            Drag to rotate · Pinch or scroll to zoom · Hover or click a dot for the agent preview
          </p>
        </div>
      </div>
    </div>
  );
}
