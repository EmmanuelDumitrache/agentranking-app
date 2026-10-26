import { notFound } from "next/navigation";
import { MEDUSA_LOGO_SRC } from "@/lib/medusa/config";
import { MEDUSA_DOCS_PARTNER_FIELDS } from "@/lib/medusa/partner-content";
import { fairscaleClientUiEnabled } from "@/lib/fairscale/config";
import { FAIRSCALE_DOCS_PARTNER } from "@/lib/fairscale/partner-content";
import { OPENVECTA_DOCS_PARTNER } from "@/lib/openvecta/partner-content";
/** Public /docs/partners hub — metadata and link lists for partner detail pages. */
export type DocsPartnerCategory = "infrastructure" | "agent" | "ecosystem";
export type DocsPartnerLink = {
  readonly label: string;
  readonly href: string;
  /** Default `true` for `http` links; internal paths should use `false`. */
  readonly external?: boolean;
};
export type DocsPartner = {
  readonly slug: string;
  readonly name: string;
  /** SEO / meta description */
  readonly description: string;
  readonly tagline: string;
  readonly category: DocsPartnerCategory;
  /** Optional logo under `public/` (e.g. `/branding/oobe/oobe-wordmark.png`). */
  readonly logoSrc?: string;
  /** Hub card target when set; otherwise `/docs/partners/:slug`. */
  readonly hubHref?: string;
  readonly hubExternal?: boolean;
  readonly chain?: string;
  readonly tags?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly website?: string;
  readonly docsUrl?: string;
  readonly integrationStatus?: string;
  readonly highlights: readonly string[];
  readonly socials: readonly DocsPartnerLink[];
  readonly relatedOnAgentRanking: readonly DocsPartnerLink[];
};
export const DOCS_PARTNERS: readonly DocsPartner[] = [
  {
    slug: "xona-agent",
    name: "Xona",
    description:
      "Xona is a production SAP-indexed creative agent on AgentRanking — metered x402, directory discovery, and optional EVM registry twins.",
    tagline: "Creative agent stack with x402 commerce and AgentRanking distribution.",
    category: "agent",
    logoSrc: "/news/articles/xona-agent-logo.png",
    hubHref: "https://xona-agent.com",
    hubExternal: true,
    highlights: [
      "On Solana, OOBE indexing may store a longer marketing title while ERC-8004 registries use a shorter name — both often share a slug prefix such as xona-agent-….",
      "When slugs diverge, AgentRanking can relate OOBE and EVM rows using shared listing URLs (WEB, x402, MCP endpoints) via the twin index.",
      "Official site and x402 manifest are the best starting points; use AgentRanking search for the live listing.",
    ],
    socials: [
      { label: "Xona website", href: "https://xona-agent.com", external: true },
      { label: "X (Twitter)", href: "https://x.com/xona_agent", external: true },
    ],
    relatedOnAgentRanking: [
      { label: "Partner notes", href: "/docs/partners/xona-agent", external: false },
      { label: "Browse agents", href: "/agents", external: false },
      { label: "OOBE dashboard", href: "/sap", external: false },
    ],
  },
  {
    slug: "oobe-synapse",
    name: "OOBE",
    description:
      "OOBE protocol, Synapse Agent Protocol, OOBE Explorer, and Synapse RPC — infrastructure that powers Solana agents listed on AgentRanking.",
    tagline: "Agent registration, Explorer, and high-performance Solana RPC from the OOBE stack.",
    category: "infrastructure",
    logoSrc: "/branding/oobe/oobe-wordmark.png",
    highlights: [
      "OOBE-registered agents are indexed into AgentRanking for discovery alongside ERC-8004 listings.",
      "OOBE Explorer is the primary surface for agent registration and on-chain identity on Solana.",
      "Synapse RPC provides Solana JSON-RPC infrastructure; operator overrides use the SYNAPSE_RPC_URL environment variable (HTTPS RPC endpoint only, not referral landing URLs).",
    ],
    socials: [
      {
        label: "Synapse RPC — referral signup",
        href: "https://synapse.oobeprotocol.ai/r/ref_jy3z67SP1rtD",
        external: true,
      },
      { label: "Synapse (homepage)", href: "https://synapse.oobeprotocol.ai/", external: true },
      { label: "OOBE Explorer", href: "https://explorer.oobeprotocol.ai", external: true },
    ],
    relatedOnAgentRanking: [
      { label: "OOBE documentation", href: "/docs/partners/oobe-synapse", external: false },
      { label: "Synapse RPC on AgentRanking", href: "/docs/partners/oobe-synapse", external: false },
      { label: "OOBE indexing & sync", href: "/docs/partners/oobe-synapse", external: false },
      { label: "Live OOBE dashboard", href: "/sap", external: false },
    ],
  },
  {
    slug: "sendai-solana-skills",
    name: "SendAI & Solana Skills",
    description:
      "SendAI maintains Solana Skills — a curated directory of agent skills for Solana development in AI coding tools.",
    tagline: "Protocol-tuned skills for Cursor, Claude, and other coding agents building on Solana.",
    category: "ecosystem",
    highlights: [
      "Solana Skills packages instructions, examples, and resources so coding agents integrate Solana protocols with fewer mistakes.",
      "It complements on-chain agent directories: use skills while building, and list or verify your agent on AgentRanking when you want distribution and trust signals.",
    ],
    socials: [{ label: "Solana Skills", href: "https://www.solanaskills.com/", external: true }],
    relatedOnAgentRanking: [
      {
        label: "Editorial: Solana Skills explained",
        href: "/news/solana-skills-sendai-directory",
        external: false,
      },
      { label: "Documentation overview", href: "/docs", external: false },
    ],
  },
  OPENVECTA_DOCS_PARTNER,
  {
    slug: MEDUSA_DOCS_PARTNER_FIELDS.slug,
    name: MEDUSA_DOCS_PARTNER_FIELDS.name,
    description: MEDUSA_DOCS_PARTNER_FIELDS.description,
    tagline: MEDUSA_DOCS_PARTNER_FIELDS.tagline,
    category: MEDUSA_DOCS_PARTNER_FIELDS.category,
    logoSrc: MEDUSA_LOGO_SRC,
    chain: MEDUSA_DOCS_PARTNER_FIELDS.chain,
    tags: MEDUSA_DOCS_PARTNER_FIELDS.tags,
    capabilities: MEDUSA_DOCS_PARTNER_FIELDS.capabilities,
    website: MEDUSA_DOCS_PARTNER_FIELDS.website,
    docsUrl: MEDUSA_DOCS_PARTNER_FIELDS.docsUrl,
    integrationStatus: MEDUSA_DOCS_PARTNER_FIELDS.integrationStatus,
    highlights: MEDUSA_DOCS_PARTNER_FIELDS.highlights,
    socials: [
      { label: "Medusa website", href: MEDUSA_DOCS_PARTNER_FIELDS.website, external: true },
      { label: "Medusa docs", href: MEDUSA_DOCS_PARTNER_FIELDS.docsUrl, external: true },
    ],
    relatedOnAgentRanking: [
      { label: "Browse agents", href: "/agents", external: false },
      { label: "Verification", href: "/verified", external: false },
      { label: "All partners", href: "/docs/partners", external: false },
    ],
  },
] as const satisfies readonly DocsPartner[];
const FAIRSCALE_PARTNERS = fairscaleClientUiEnabled() ? [FAIRSCALE_DOCS_PARTNER] : [];
export function listDocsPartners(): readonly DocsPartner[] {
  return [...DOCS_PARTNERS, ...FAIRSCALE_PARTNERS];
}
export function getDocsPartnerBySlug(slug: string): DocsPartner | undefined {
  return listDocsPartners().find((p) => p.slug === slug);
}
/** Resolves a partner for docs detail routes; `notFound()` when the slug is unknown. */
export function requireDocsPartner(slug: string): DocsPartner {
  const p = getDocsPartnerBySlug(slug);
  if (p !== undefined) return p;
  notFound();
}
