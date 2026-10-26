import Image from "next/image";
import Link from "next/link";
import { agentPublicPath } from "@/lib/agent-public-url";

const XONA_AGENT_PROFILE_PATH = agentPublicPath({
  chainId: 900_001,
  agentId: 1_455,
  name: "XONA Agent",
});
/**
 * Editorial “integration” strip for XONA news — logo + tagline + directory / protocol links (not a SaaS iframe).
 */
export function XonaIntegrationWidget() {
  return (
    <div className="my-8 rounded-xl border border-border bg-gradient-to-br from-muted/70 to-muted/35 p-4 sm:p-5 shadow-sm ring-1 ring-border/70">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-black">
          <Image
            src="/news/articles/xona-agent-logo.png"
            alt="XONA Agent logo"
            width={52}
            height={52}
            className="object-cover"
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-semibold text-foreground">XONA Agent</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              AI agent · agentic commerce · agentic capital markets
            </p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            SAP-listed creative agent — pay-per-use via x402, directory profile on AgentRanking, and live updates from{" "}
            <a href="https://x.com/xona_agent" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
              @xona_agent
            </a>
            .
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-medium">
            <Link href={XONA_AGENT_PROFILE_PATH} className="text-primary underline-offset-4 hover:underline">
              Listing on AgentRanking
            </Link>
            <a
              href="https://api.xona-agent.com/.well-known/x402"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              x402 manifest
            </a>
            <Link href="/docs/partners/xona-agent" className="text-primary underline-offset-4 hover:underline">
              Partner docs
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
