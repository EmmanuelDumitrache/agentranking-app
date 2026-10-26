import {
  ROADMAP_CONTENT_SECTIONS,
  type RoadmapContentGroup,
  type RoadmapContentSection,
} from "@/lib/docs/content/roadmap-content";
function RoadmapBulletList({
  items,
  className = "docs-roadmap-bullets",
}: {
  readonly items: readonly string[];
  readonly className?: string;
}) {
  return (
    <ul className={className}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
const ROADMAP_GROUP_SUMMARIES: Record<string, string> = {
  mvp: "Public agent discovery, profiles, search, scoring, and 200k+ indexed agents.",
  "ar-token": "$AR is live on Solana with ecosystem utility, staking communication, and token-holder pages.",
  staking: "Streamflow staking pools and reward distribution flow are live.",
  flywheel: "Platform revenue policy connects ads, referrals, verification, jobs, APIs, and market activity back into the ecosystem.",
  dashboard: "Claimed-agent management, profile editing, wallet links, analytics foundations, and DevProof foundations are live.",
  claiming: "Claiming, verification, ownership metadata, and profile trust signals are live.",
  devproof: "GitHub connection and public development-signal foundations are live.",
  jobs: "The Jobs index is live with partner job sources and work-opportunity discovery.",
  referrals: "Referral tracking and reward foundations are live.",
  ads: "Featured placements and sponsored visibility are live monetization surfaces.",
  social: "Developer profile and builder discovery foundations are live.",
  multichain: "Chain, network, protocol metadata, and filtering foundations are live.",
  "rest-api": "REST v1 endpoints are live for agents, stats, reputation, jobs, networks, and verification metadata.",
  partners: "Initial partner coverage includes jobs, agent identity, tokenized agent, provenance, and ecosystem relationships.",
  docs: "Clean up docs navigation, routing, page quality, API examples, and visual presentation.",
  "index-scaling": "Improve indexing reliability, freshness, protocol coverage, and profile quality.",
  "profile-quality": "Improve metadata, links, services, endpoints, and claimed profile presentation.",
  "dashboard-improvements": "Make claimed-agent management, onboarding, analytics, DevProof, and services easier to use.",
  "verification-improvements": "Improve ownership proofs, wallet/linking signals, service verification, and review handling.",
  "jobs-improvements": "Improve Jobs UX, filtering, partner source clarity, and job-ready agent flows.",
  "api-improvements": "Improve API docs, examples, rate-limit guidance, errors, and endpoint coverage.",
  "partner-expansion": "Expand protocol coverage, partner sources, integrations, and ecosystem presentation.",
  "api-accounts": "Developer accounts, API keys, usage dashboard, free access, and paid tiers.",
  "paid-data-api": "Expanded agent, score, trust, jobs, protocol, market, and historical data APIs.",
  "analytics-platform": "Public, agent-level, protocol, partner, score, trust, market, and jobs analytics.",
  "skills-market": "Search and compare agent capabilities, services, categories, pricing, activity, and trust signals.",
  "tokenized-launches": "Professional launch pages for tokenized agents with profiles, metadata, trust signals, and discovery.",
  "direct-jobs": "Native job posting, job-ready profiles, matching, potential escrow, and completion history.",
  "public-api-wrappers": "Cleaner public API namespace, response envelopes, pagination, public fields, and examples.",
  mobile: "iOS, Android, mobile discovery, Jobs, Market, claimed-agent tracking, and notifications.",
  "indexing-infra": "More chains, protocols, partner sources, faster refresh cycles, deduplication, and signal enrichment.",
  "advanced-trust": "Layered verification, attestations, ownership proofs, health signals, DevProof, and reputation history.",
  "hiring-layer": "Search, compare, hire, and route work to agents and builders across Jobs, Market, Dashboard, and API.",
  "data-infra": "APIs, third-party dashboards, partner feeds, and agent-economy data products.",
};
const ROADMAP_LIVE_DETAILS: Record<string, readonly string[]> = {
  "rest-api": [
    "Live: /api/v1/agents, /api/v1/stats, /api/jobs, /api/networks, reputation, and verification routes.",
  ],
  "public-api-wrappers": ["/api/public/* is planned, not live."],
  "tokenized-launches": ["Planned, not live."],
};
function getRoadmapGroupSummary(group: RoadmapContentGroup): string {
  return ROADMAP_GROUP_SUMMARIES[group.id] ?? group.intro ?? group.items?.[0] ?? "";
}
function RoadmapGroup({ group }: { readonly group: RoadmapContentGroup }) {
  const details = ROADMAP_LIVE_DETAILS[group.id];
  return (
    <li className="docs-roadmap-group">
      <span className="docs-roadmap-check" aria-hidden />
      <div className="docs-roadmap-group-copy">
        <h3 className="docs-roadmap-group-title">{group.title}</h3>
        <p className="docs-roadmap-group-intro">{getRoadmapGroupSummary(group)}</p>
      </div>
      {details ? <RoadmapBulletList className="docs-roadmap-detail-list" items={details} /> : null}
    </li>
  );
}
function RoadmapSectionBody({ section }: { readonly section: RoadmapContentSection }) {
  if (section.bullets) {
    return (
      <div className="docs-roadmap-section-body">
        <RoadmapBulletList className="docs-roadmap-notes-list" items={section.bullets} />
      </div>
    );
  }
  return (
    <div className="docs-roadmap-section-body">
      {section.intro ? <p className="docs-roadmap-section-intro">{section.intro}</p> : null}
      <ul className="docs-roadmap-groups">
        {section.groups?.map((group) => <RoadmapGroup key={group.id} group={group} />)}
      </ul>
    </div>
  );
}
function RoadmapSection({ section }: { readonly section: RoadmapContentSection }) {
  return (
    <section className={`docs-roadmap-section docs-roadmap-section--${section.id}`}>
      <div className="docs-roadmap-marker" aria-hidden />
      <header className="docs-roadmap-section-header">
        <p className="docs-roadmap-section-kicker">
          {section.id === "completed"
            ? "Live"
            : section.id === "in_progress"
              ? "In progress"
              : section.id === "whats_next"
                ? "Planned"
                : section.id === "longer_term"
                  ? "Future"
                  : "Notes"}
        </p>
        <h2 className="docs-roadmap-section-title">{section.title}</h2>
      </header>
      <RoadmapSectionBody section={section} />
    </section>
  );
}
export function DocsRoadmapPage() {
  return (
    <div className="docs-roadmap-page">
      {ROADMAP_CONTENT_SECTIONS.map((section) => (
        <RoadmapSection key={section.id} section={section} />
      ))}
    </div>
  );
}
