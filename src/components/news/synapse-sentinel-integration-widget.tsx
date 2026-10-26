import Image from "next/image";
import Link from "next/link";
import { agentPublicPath } from "@/lib/agent-public-url";

const SYNAPSE_SENTINEL_PROFILE_PATH = agentPublicPath({
  chainId: 900_001,
  agentId: 1_456,
  name: "Synapse Sentinel",
});
/**
 * Integration strip for the Synapse Sentinel feature — OOBE partnership, Sentinel listing,
 * explorer, Synapse OOBE voice on X (not a SaaS iframe).
 */
export function SynapseSentinelIntegrationWidget() {
  return (
    <div className="my-8 rounded-xl border border-border bg-gradient-to-br from-violet-950/40 via-muted/60 to-cyan-950/25 p-4 sm:p-5 shadow-sm ring-1 ring-border/70">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative flex h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
          <Image
            src="/news/articles/synapse-rpc-logo.png"
            alt="Synapse logo"
            width={52}
            height={52}
            className="object-cover"
          />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-sm font-semibold text-foreground">Synapse Sentinel · AgentRanking</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              OOBE-backed SAP listing · Metered tooling via SynapseAgentKit · x402
            </p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Synapse RPC messaging highlights fast, reliable routing on Solana — the explorer and protocol surface
            OOBE publishes are what Sentinel plugs into once you leave the brochure and open an HTTP handle. Product
            voice also ships on{" "}
            <a
              href="https://x.com/SynapseOobe"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              @SynapseOobe on X
            </a>
            .
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-medium">
            <Link href={SYNAPSE_SENTINEL_PROFILE_PATH} className="text-primary underline-offset-4 hover:underline">
              Sentinel listing
            </Link>
            <Link href="/docs/partners/oobe-synapse" className="text-primary underline-offset-4 hover:underline">
              OOBE &amp; Synapse docs
            </Link>
            <Link href="/docs/agent-index#chains-and-protocols" className="text-primary underline-offset-4 hover:underline">
              SAP ingestion guide
            </Link>
            <a
              href="https://explorer.oobeprotocol.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              OOBE Explorer
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
