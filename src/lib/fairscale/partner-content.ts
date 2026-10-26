import type { DocsPartner } from "@/content/docs-partners";
import { FAIRSCALE_METHODOLOGY_URL } from "@/lib/fairscale/config";
import { FAIRSCALE_LOGO_SRC, FAIRSCALE_WEBSITE_URL } from "@/lib/fairscale/urls";

export const FAIRSCALE_DOCS_PARTNER: DocsPartner = {
  slug: "fairscale",
  name: "FairScale",
  description:
    "FairScale provides an independent Agent Trust signal for compatible Solana agent wallets on AgentRanking — separate from AR Agent Score.",
  tagline: "Independent third-party trust assessments for Solana agent wallets.",
  category: "ecosystem",
  logoSrc: FAIRSCALE_LOGO_SRC,
  chain: "Solana",
  tags: ["trust", "reputation", "solana", "agents"],
  capabilities: [
    "Agent Trust score (0–100)",
    "Five trust pillars",
    "Verification signals and badges",
    "Description alignment checks",
  ],
  website: FAIRSCALE_WEBSITE_URL,
  docsUrl: FAIRSCALE_METHODOLOGY_URL,
  integrationStatus: "Solana agent wallets · cached assessments on agent profiles",
  highlights: [
    "AgentRanking handles launch, discovery, profiles, and AR Agent Score.",
    "FairScale provides an independent trust/reputation signal — the two scores are never combined.",
    "Eligible Solana agents display FairScale Trust on their profile when FAIRSCALE_ENABLED is on.",
    "EVM-only agents show a supported-network notice until FairScale expands coverage.",
    "Trust pillars: Verification, Wallet history, Work history, Network quality, Peer reputation.",
  ],
  socials: [
    { label: "FairScale", href: FAIRSCALE_WEBSITE_URL, external: true },
    { label: "Methodology", href: FAIRSCALE_METHODOLOGY_URL, external: true },
  ],
  relatedOnAgentRanking: [
    { label: "Browse agents", href: "/agents", external: false },
    { label: "Verification", href: "/verified", external: false },
    { label: "All partners", href: "/docs/partners", external: false },
  ],
};
