import Link from "next/link";
import Image from "next/image";
import { ExternalLink } from "lucide-react";
import { getSapAgentCount } from "@/lib/sap-ecosystem";
import { cn } from "@/lib/utils";
/** Agent registration / discovery on OOBE — use Explorer (not marketing root). */
const OOBE_EXPLORER_REGISTER_URL = "https://explorer.oobeprotocol.ai";
const railSecondary = cn(
  "inline-flex w-full shrink-0 items-center justify-center rounded-md border border-border/50 bg-background/30 px-2.5 py-1 text-center text-[11px] font-medium leading-snug text-muted-foreground transition-colors",
  "hover:border-emerald-500/40 hover:bg-background/45 hover:text-foreground",
  "sm:text-xs xl:py-[0.3125rem]",
);
export async function SapOobePartnershipBand(props?: { agentCount?: number }) {
  const agentCount = props?.agentCount;
  const n = agentCount ?? (await getSapAgentCount());
  return (
    <section
      className="relative overflow-hidden rounded-lg border border-emerald-500/20 bg-gradient-to-r from-emerald-950/35 via-background to-violet-950/15 px-2 py-2 sm:rounded-xl sm:px-4 sm:py-3 md:px-5 md:py-3.5"
      aria-labelledby="sap-oobe-heading"
    >
      <div
        className="pointer-events-none absolute -left-6 top-1/2 h-16 w-16 -translate-y-1/2 rounded-full bg-emerald-500/6 blur-xl sm:h-28 sm:w-28 sm:bg-emerald-500/8 sm:blur-2xl"
        aria-hidden
      />
      {/*
        Use xl (not lg) before splitting into headline + sidebar.
        Below xl: buttons stack full-width under the copy so multi-word labels
        never squeeze the headline column beside a wide button row at md/lg breakpoints.
      */}
      <div className="relative grid w-full gap-2 sm:gap-2.5 xl:grid-cols-[minmax(0,1fr)_minmax(12rem,17rem)] xl:items-start xl:gap-x-8">
        <div className="min-w-0 w-full max-w-full space-y-0.5 sm:space-y-1 md:space-y-1.5">
          <p className="flex items-center gap-2 text-[9px] font-semibold uppercase leading-tight tracking-wide text-emerald-400/90 sm:gap-2.5 sm:text-[10px] sm:tracking-[0.12em]">
            <Image
              src="/branding/oobe/oobe-wordmark.png"
              alt="OOBE"
              width={500}
              height={500}
              sizes="(max-width: 640px) 88px, 128px"
              className="h-[22px] w-auto max-w-[6rem] shrink-0 object-contain sm:h-7 sm:max-w-[7.5rem] md:h-8 md:max-w-[8.5rem]"
            />
            <span className="min-w-0 leading-tight line-clamp-2 sm:line-clamp-1">Synapse Agent Protocol</span>
          </p>
          <h2
            id="sap-oobe-heading"
            className="w-full max-w-full text-[0.8125rem] font-semibold leading-snug tracking-tight text-foreground sm:text-base md:text-[1.05rem] md:leading-snug xl:leading-tight"
          >
            AgentRanking is the official discovery layer for SAP registered agents
          </h2>
          <p className="hidden w-full max-w-full text-xs leading-snug text-muted-foreground sm:block sm:max-w-none sm:text-[0.8125rem] sm:leading-relaxed">
            List on SAP, surface automatically on AgentRanking search, compare, and capability pages — reach developers
            looking for production Solana agents.
          </p>
          <p
            className="text-[10px] font-medium leading-tight text-emerald-200/90 sm:text-xs sm:leading-normal"
            aria-live="polite"
          >
            <span className="font-semibold tabular-nums text-emerald-100">{n.toLocaleString()}</span>
            <span className="text-emerald-300/85"> registered agents</span>
          </p>
        </div>
        <nav
          className={cn(
            "flex w-full min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-1.5",
            "xl:w-full xl:min-w-0 xl:max-w-full xl:flex-col xl:flex-nowrap xl:items-stretch xl:justify-center xl:gap-1",
          )}
          aria-label="SAP and OOBE actions"
        >
          <a
            href={OOBE_EXPLORER_REGISTER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex min-h-0 w-full shrink-0 items-center justify-center gap-1 whitespace-normal rounded-md border border-emerald-500/30 bg-emerald-600 px-2.5 py-1 text-center text-[11px] font-semibold leading-snug text-white shadow-[0_1px_2px_-1px_rgba(16,185,129,0.45)] transition-colors hover:bg-emerald-500 hover:brightness-[1.02]",
              "sm:text-xs xl:py-[0.3125rem]",
            )}
          >
            <span className="sm:hidden">Register on SAP</span>
            <span className="hidden sm:inline">Register your agent on SAP</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-85" aria-hidden />
            <span className="sr-only"> — opens in a new tab</span>
          </a>
          <Link href="/sap" className={railSecondary}>
            <span className="sm:hidden">SAP agents</span>
            <span className="hidden sm:inline">View SAP agents</span>
          </Link>
          <Link href="/sap/capabilities" className={railSecondary}>
            <span className="sm:hidden">Capabilities</span>
            <span className="hidden sm:inline">Browse capabilities on AgentRanking</span>
          </Link>
          <Link href="/docs/partners/oobe-synapse" className={railSecondary}>
            <span className="sm:hidden">OOBE &amp; Synapse docs</span>
            <span className="hidden sm:inline">OOBE &amp; Synapse in docs</span>
          </Link>
        </nav>
      </div>
    </section>
  );
}