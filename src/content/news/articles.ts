import { agentPublicPath } from "@/lib/agent-public-url";

const SYNAPSE_SENTINEL_PROFILE_PATH = agentPublicPath({
  chainId: 900_001,
  agentId: 1_456,
  name: "Synapse Sentinel",
});
const XONA_AGENT_PROFILE_PATH = agentPublicPath({
  chainId: 900_001,
  agentId: 1_455,
  name: "XONA Agent",
});

export interface ArticleAgentListConfig {
  sort: "score" | "feedback" | "created";
  limit: number;
  chainId?: number;
  x402?: boolean;
}
export interface HowToStep {
  name: string;
  text: string;
}
export interface FaqItem {
  question: string;
  answer: string;
}
export type ArticleCategory =
  | "protocol"
  | "guides"
  | "mcp"
  | "telegram"
  | "payments"
  | "rankings"
  | "ecosystem";
export interface NewsArticle {
  slug: string;
  title: string;
  excerpt: string;
  content?: string;
  contentBeforeList?: string;
  contentAfterList?: string;
  agentList?: ArticleAgentListConfig;
  image: string;
  publishedAt: string;
  author: string;
  category?: ArticleCategory;
  howToSteps?: HowToStep[];
  faq?: FaqItem[];
  /** Embedded UI for specific articles (tweet iframes, integration widget). Parsed in `news/[slug]`. */
  newsEmbeds?: Readonly<{ tweetIframeIds: readonly string[] }>;
}
export const ARTICLES: NewsArticle[] = [
  {
    slug: "ar-credentials-explained",
    title: "How AgentRanking credentials work — and why they are not a green check on a token",
    excerpt:
      "An AR-ID is a public pass on the person who runs the agents, not a stamp that the agent will make money. One check, inherited by every listing they own.",
    image: "/news/articles/on-chain-reputation-trust.png",
    publishedAt: "2026-08-19T10:00:00Z",
    author: "AgentRanking",
    category: "guides",
    howToSteps: [
      {
        name: "Know the difference",
        text: "On-chain registration lists the agent. A credential is about the operator behind it.",
      },
      {
        name: "Look for AR-…",
        text: "If the operator passed identity verification, the agent page shows a public code like AR-CMS43W0C8000.",
      },
      {
        name: "Open the proof",
        text: "The code links to a public proof. It does not publish passport scans or home addresses.",
      },
      {
        name: "Do not stop there",
        text: "Still read rankings, FairScale, on-chain history, and the product. A credential is one signal.",
      },
    ],
    faq: [
      {
        question: "What is an AgentRanking credential?",
        answer:
          "A public operator ID (AR-…) issued after the account holder completes identity verification. It is attached to the person or business, then shown on agents they own.",
      },
      {
        question: "Does a credential mean the agent is a good investment?",
        answer:
          "No. It means someone identifiable completed a check. It does not rate the token, predict returns, or replace your own research.",
      },
      {
        question: "Is this the same as claiming or registering an agent?",
        answer:
          "No. Registering puts the agent on-chain. Claiming lets the owner edit the dashboard listing. The credential is a separate KYC-style pass on the account, done once.",
      },
      {
        question: "Do I KYC every agent?",
        answer:
          "No. Verify the account once. Every agent that account owns can inherit the same public AR-ID while the credential stays valid.",
      },
      {
        question: "What shows up in public?",
        answer:
          "The AR-ID, verification level (individual or business), status, and dates. Not government ID images or private documents.",
      },
    ],
    content: `
      <p>If you only remember one thing from this post: <strong>a credential is about who is running the agents, not whether those agents will print money.</strong></p>
      <p>Anyone can put an agent on a registry. That is like filing a company name. Useful. Not the same as knowing a real person stands behind it.</p>
      <h2>The simple picture</h2>
      <p>Think of three layers. They look similar on a profile. They are not the same product.</p>
      <ul>
        <li><strong>Listed.</strong> The agent exists on-chain. We indexed it. That is registration.</li>
        <li><strong>Claimed.</strong> Someone proved they control that listing and can edit the page.</li>
        <li><strong>Credentialed.</strong> The operator completed an identity check on their AgentRanking account. They get a public ID that starts with <code>AR-</code>. Agents they own can show that same ID.</li>
      </ul>
      <p>You KYC the account once. You do not KYC every bot, every chain, every token.</p>
      <h2>What you actually see</h2>
      <p>When a credential is live, public pages can show a small chip: a code like <code>AR-CMS43W0C8000</code>. Click it and you get a proof page — status, individual or business, issued and expiry dates. No passport photos. No home address. No “this token is safe.”</p>
      <p>Operators see the full card in Dashboard → Credentials after they verify. AI clients can read the same public fact through our <a href="/mcp">MCP connector</a> (<code>get_agent_credential</code>). Humans and machines get the same number.</p>
      <h2>Why this matters if you are not a developer</h2>
      <p>Markets in this space are noisy. Copycat names. Fresh wallets. “Verified” used as marketing. A public AR-ID is a boring, checkable handle on the operator.</p>
      <p>It helps you answer a narrower question: <em>is there a real operator on file, and is it the same operator across their listings?</em> That is closer to “who is the management company?” than “will this coin go up.”</p>
      <h2>What it does not mean</h2>
      <ul>
        <li>Not a buy rating, audit, or insurance.</li>
        <li>Not a score of the agent’s skill, revenue, or token.</li>
        <li>Not a substitute for rankings, FairScale, on-chain history, or reading the actual product.</li>
        <li>Not forever. Credentials can expire or be revoked. If the check is no longer valid, the public chip goes away.</li>
      </ul>
      <p>Treat it like seeing a registered director next to a ticker — useful context, still your call.</p>
      <h2>How operators get one</h2>
      <p>Sign in at <a href="https://app.agentranking.io/dashboard/credentials">app.agentranking.io</a>, complete account verification, then open Credentials. One pass covers the agents that account owns. Listing a new agent later does not mean starting KYC from zero.</p>
      <p>This is not the old “sign a wallet message to claim this profile” flow. That still exists. It proves control of a listing. The AR-ID proves an identity check on the account.</p>
      <h2>How we will talk about it</h2>
      <p>We will not collapse “listed,” “claimed,” and “credentialed” into one green tick. If a page only says “verified,” ask which layer. The public AR-ID is the credential layer.</p>
      <p>Browse agents on <a href="/agents">agentranking.io/agents</a>. If you see an <code>AR-</code> chip, you can open the proof. If you do not, the operator has not completed (or no longer holds) that check — which is information too.</p>
      <p><em>Not financial advice. Credentials are a trust signal, not a guarantee of performance, safety, or returns.</em></p>
    `,
  },
  {
    slug: "feature-synapse-sentinel-oobe-sap-gateway",
    title: "Spotlight: Synapse Sentinel — OOBE’s SAP x402 gateway on AgentRanking",
    excerpt:
      "We’re putting Synapse Sentinel front and center: the SAP-listed pay-per-call gateway to 110+ SynapseAgentKit tools, sitting on OOBE’s explorer + Synapse RPC stack — with directory context on AgentRanking.",
    image: "/news/articles/synapse-rpc-banner.png",
    publishedAt: "2026-05-05T15:00:00Z",
    author: "AgentRanking",
    category: "ecosystem",
    newsEmbeds: {
      tweetIframeIds: [],
    },
    content: `
      <p><strong>Today we’re highlighting</strong> <a href="${SYNAPSE_SENTINEL_PROFILE_PATH}">Synapse Sentinel</a> — a concrete SAP agent on Solana that OOBE-aligned teams use as an <strong>x402-metered doorway</strong> into a broad SynapseAgentKit tool surface — and explaining how it fits AgentRanking alongside our partnership with <strong>OOBE</strong> (Explorer, indexing-adjacent infrastructure, and Synapse RPC messaging).</p>
      <p><strong>For integrators,</strong> the pitch is tangible: negotiate calls through HTTP payment choreography instead of juggling one-off tariffs per tool fork, while still grounding identity in SAP and reconciling manifests in OOBE Explorer. <strong>AgentRanking</strong> remains a neutral catalog: ERC-8004 on EVM and SAP on Solana, with scores, badges, x402 cues, and human review where useful — never a substitute for your own diligence (<a href="/news/ai-agents-x402-payments">what x402 is</a>).</p>
      <p><strong>At a glance</strong></p>
      <ul>
        <li><strong>Synapse Sentinel:</strong> pay-per-call gateway — <em>110 SynapseAgentKit tools</em> via SAP x402; <a href="${SYNAPSE_SENTINEL_PROFILE_PATH}">live dossier</a>.</li>
        <li><strong>OOBE &amp; Explorer:</strong> canonical tool walks and registry choreography — see <a href="/docs/partners/oobe-synapse">OOBE &amp; Synapse</a> and <a href="https://explorer.oobeprotocol.ai" rel="noopener noreferrer">explorer.oobeprotocol.ai</a>.</li>
        <li><strong>Directory signals:</strong> SAP registry <strong>#1456</strong>; AgentRanking <strong>Verified</strong> + <strong>SAP verification</strong> on the listing at publish.</li>
        <li><strong>Public voice:</strong> roadmap-style color on <a href="https://x.com/SynapseOobe" rel="noopener noreferrer">@SynapseOobe</a> — stack against Explorer rows, not hype alone.</li>
      </ul>
      <p><em>Updated May 2026: hero + widget layout highlight Synapse RPC artwork and Sentinel links in an announcement-style feature.</em></p>
      <!--ar-news-synapse-a-->
      <h2>Synapse infra on Solana — RPC next to explorer UX</h2>
      <p>Synapse&apos;s public messaging emphasizes performant RPC for Solana — &quot;fast, reliable, intelligent routing&quot; — alongside OOBE-hosted discovery. Sentinel sits downstream as a callable listing: entries flow into AgentRanking, Explorer enumerates tooling, and Sentinel exposes SynapseAgentKit breadth under SAP-aware x402 so autonomous clients agree on price before execution.</p>
      <p>When you validate infra decisions, skim <a href="https://x.com/SynapseOobe" rel="noopener noreferrer">Synapse OOBE posts</a> for macro context, reconcile with Explorer, then use AgentRanking scores to see how metadata depth and declared endpoints show up in-directory.</p>
      <!--ar-news-synapse-b-->
      <h2>Why Synapse Sentinel exists</h2>
      <p><strong>Synapse Sentinel</strong> is the SAP-listed agent teams reach for when they want a deterministic tool bus packaged as a single SKU. Its line in the directory: <em>“Pay-per-call gateway exposing 110 SynapseAgentKit tools via SAP x402.”</em> Metering stays on HTTP 402 flows instead of bespoke billing for every fork.</p>
      <p>Badges matter but don’t replace legal review: <strong>Verified</strong> reflects our editorial pass; <strong>SAP verification</strong> reflects protocol-level identity alignment.</p>
      <h2>What builders get: concrete endpoints</h2>
      <p>From Sentinel&apos;s listing (<a href="${SYNAPSE_SENTINEL_PROFILE_PATH}">open profile</a>):</p>
      <ul>
        <li><strong>X402 — v1.0:</strong> <code>https://agent.sentinel.oobeprotocol.ai/tools/:name</code> — replace <code>:name</code> with the negotiated tool; this is Sentinel&apos;s metering lane.</li>
        <li><strong>WEB — v1.0:</strong> <code>https://explorer.oobeprotocol.ai/agents/Ccr2yK3hLALU4p8oNRqrh4dGuvPJTth5KCLMio8cE1ph?tab=tools</code> — Explorer UI for tooling on the same identity.</li>
      </ul>
      <p>Score snapshot at publish (<a href="${SYNAPSE_SENTINEL_PROFILE_PATH}">verify live</a>): composite <strong>44</strong>, metadata depth <strong>95</strong>, endpoint declaration signal <strong>28</strong> — a profile biased toward specificity over hype.</p>
      <h2>How this sits next to OOBE tooling</h2>
      <p>Sentinel collapses SynapseAgentKit spread behind one SAP façade. OOBE runs registry and explorer ergonomics; Sentinel is the payoff for wallets and orchestrators that want repeatable HTTP semantics and x402 metering. Compared to creator-first SAP agents, this one reads as infrastructure plumbing plus checkout.</p>
      <h2>If you integrate</h2>
      <p>Start from Explorer manifests, branch to Sentinel paywalls where you need metering, use the AgentRanking REST API when you want catalog queries before treasury work (<a href="/docs/api">API docs</a>), and scale only after simulator passes. Aggregate SAP views live on our <a href="/sap">SAP dashboard</a>.</p>
      <p>Prefer creative SAP narratives to gateway infra? Jump to <a href="/news/feature-xona-agent-creative-x402-sap">the XONA Agent feature</a> next.</p>
    `,
  },
  {
    slug: "feature-xona-agent-creative-x402-sap",
    title: "XONA Agent: Creative Media, x402 Metering, and SAP Verification on Solana",
    excerpt:
      "AgentRanking in brief, then XONA Agent — SAP-verified creative APIs with open x402 discovery, plus Seeker mobile distribution and embedded live posts.",
    image: "/news/articles/xona-agent-logo.png",
    publishedAt: "2026-05-05T16:00:00Z",
    author: "AgentRanking",
    category: "ecosystem",
    newsEmbeds: {
      tweetIframeIds: ["2047384558614577649"],
    },
    content: `
      <p><strong>AgentRanking</strong> indexes verifiable AI agents across chains so integrators can compare trust, capabilities, and payment rails in one place. Alongside ERC-8004 networks we mirror <strong>SAP</strong> identities from the OOBE stack; if you need the longer partnership context, start with <a href="/docs/partners/oobe-synapse">OOBE &amp; Synapse</a> before diving into any single listing.</p>
      <p><em>Updated May 2026: Seeker rollout is cited from embedded live posts plus @xona_agent’s channel — not static screenshots.</em></p>
      <!--ar-news-xona-a-->
      <h2>XONA lands on Solana Mobile (Seeker Dapp Store)</h2>
      <p>In April 2026, XONA and ecosystem accounts described shipping a handheld experience on Solana Mobile through Seeker’s <strong>Dapp Store</strong>: discover agent-powered flows, generate <strong>images, videos, and audio</strong>, publish or share creations, and pay <strong>per use via x402</strong>. Public messaging pitched <strong>no subscriptions</strong> and <strong>no traditional API keys</strong> visible to end readers — inspect the embedded posts directly for verbatim framing.</p>
      <!--ar-news-xona-b-->
      <p>That consumer surface complements SAP registration and the programmable path: callers can still reconcile against AgentRanking scores and pull machine-readable commerce from <code>https://api.xona-agent.com/.well-known/x402</code>; Seeker effectively packages the creative stack for wallets on the move.</p>
      <h2>What XONA Agent offers</h2>
      <p><strong>XONA Agent</strong> on Solana (<a href="${XONA_AGENT_PROFILE_PATH}">directory profile</a>) positions itself around creative automation: imagery, motion, audio, synthesis, plus social-ready outputs — surfaced with <a href="/news/ai-agents-x402-payments">x402</a> so metering can track real usage rather than chunky subscription SKUs alone. Capability tags echoed in SAP metadata line up with that story (image/video/music pipelines, AI-assisted publishing lanes).</p>
      <h2>Verification and why the badges differ from some other listings</h2>
      <p>XONA’s Solana row is <strong>SAP verified</strong> via Synapse Agent Protocol (shown as SAP in-product). Editorial <strong>Verified</strong> was still absent at publish — that pill is its own QA pass unrelated to OOBE cryptography. Understand both cues before translating badges into underwriting decisions.</p>
      <h2>x402 discovery endpoint</h2>
      <p>Machine-readable offers continue to reside at <code>https://api.xona-agent.com/.well-known/x402</code> — pair it with OOBE tooling and AgentRanking public API data when stitching automated treasury logic.</p>
      <h2>Numbers worth knowing</h2>
      <p>Snapshot from AgentRanking scoring (subject to churn): composite <strong>32</strong>, with youthful freshness and trustworthy wallet scaffolding even while social proof ramps. Meaning: directory math still warming, not necessarily product quality regressions.</p>
      <h2>Partner documentation</h2>
      <p>Architectural parallels between ERC-8004 clones and SAP slugs remain documented via <a href="/docs/partners/xona-agent">Xona Agent in docs</a> whenever you reconcile twin listings.</p>
      <h2>Where to go next</h2>
      <p>Iterate against manifest + OOBE explorer, keep <a href="https://explorer.oobeprotocol.ai" rel="noopener noreferrer">OOBE Explorer</a> handy for protocol breadcrumbs, then contrast with <a href="/news/feature-synapse-sentinel-oobe-sap-gateway">Synapse Sentinel’s infra-first essay</a> if orchestration gateways matter more than creator UX.</p>
    `,
  },
  // ── New 2026-04 articles ──────────────────────────────────────────────────
    {
    slug: "agentranking-agent-directory-guide",
    title: "What Is the AgentRanking Agent Directory? A Guide to Discovering and Ranking On-Chain AI Agents",
    excerpt:
      "The Agent Directory is AgentRanking's public catalog of ERC-8004 AI agents, organized by archetype and chain. Here's how discovery, verification, trust scores, and the Telegram category work.",
    image: "/og/social/agents.png",
    publishedAt: "2026-04-16T11:00:00Z",
    author: "AgentRanking",
    category: "guides",
    faq: [
      {
        question: "What is the AgentRanking Agent Directory?",
        answer:
          "The Agent Directory is the public catalog at agentranking.io/agents — a searchable, ranked catalog of ERC-8004 on-chain AI agents organized by archetype (sniper, trading, MEV, yield, DeFi, Telegram, etc.) and chain (Base, Ethereum, Solana, and more).",
      },
      {
        question: "What archetypes does AgentRanking support?",
        answer:
          "Current archetypes include: sniper, trading, MEV, yield, DeFi, social, Telegram, arbitrage, liquidation, NFT, bridge, oracle, analytics, and security. Each archetype has its own category page with filtered rankings.",
      },
      {
        question: "How is the Telegram category different?",
        answer:
          "The Telegram category (agentranking.io/telegram) lists crypto and AI Telegram bots — both standalone bots and Managed Bots. These are not on-chain ERC-8004 agents; they are indexed from public sources and can be submitted at agentranking.io/create/telegram-bot.",
      },
      {
        question: "How does verification work?",
        answer:
          "Verified agents have proven wallet ownership on-chain. Premium Verified agents have also gone through additional identity checks. Both tiers show a badge on the agent card and detail page.",
      },
      {
        question: "What is an AgentRank score?",
        answer:
          "AgentRank scores (0–100) combine profile quality, protocol trust, execution evidence, and recent activity. Higher is better. Scores are informational — not audits, endorsements, or investment advice.",
      },
    ],
    content: `
      <p>The <a href="/agents">AgentRanking Agent Directory</a> is the central directory for on-chain AI agents. Whether you're looking for a Solana sniper bot, a DeFi yield optimizer, or a Telegram trading assistant, this is where you find, compare, and evaluate them — all grounded in on-chain data.</p>
      <p>If you own or operate an agent, the creator workspace is <a href="/dashboard">Agent Dashboard</a> — claim profiles, publish capabilities, and manage verification separately from this public directory.</p>
      <h2>How the directory is organized</h2>
      <p>The directory groups agents into <strong>archetypes</strong> — categories based on what an agent does. Each archetype has its own page with filtered rankings, SEO-optimized content, and relevant agent cards:</p>
      <ul>
        <li><strong>Sniper</strong> — token launch snipers and fast-entry bots</li>
        <li><strong>Trading</strong> — general automated trading agents</li>
        <li><strong>MEV</strong> — maximal extractable value bots</li>
        <li><strong>Yield</strong> — yield farming and optimization agents</li>
        <li><strong>DeFi</strong> — DeFi protocol interaction agents</li>
        <li><strong>Telegram</strong> — crypto and AI Telegram bots (see below)</li>
        <li><strong>Analytics</strong> — data analysis and portfolio reporting agents</li>
        <li><strong>Security</strong> — auditing, monitoring, and alerting agents</li>
        <li><strong>And more:</strong> arbitrage, liquidation, NFT, bridge, oracle, social</li>
      </ul>
      <h2>Trust scores and rankings</h2>
      <p>Every agent receives an <strong>AgentRank score from 0 to 100</strong>, computed from profile quality, protocol trust, execution evidence, and activity signals:</p>
      <ul>
        <li>Metadata completeness — name, description, endpoints, services</li>
        <li>Endpoint health — can we reach the declared API?</li>
        <li>User feedback — volume and sentiment from on-chain and in-app reviews</li>
        <li>Verification tier — verified or premium-verified owners</li>
        <li>x402 support — agents with declared payment rails</li>
        <li>Optional: wallet-linked activity and Verified Revenue data</li>
      </ul>
      <p>AgentRank scores are <em>informational rankings</em> — not endorsements, audits, or investment advice.</p>
      <h2>Verification tiers</h2>
      <p>The directory distinguishes three verification levels:</p>
      <ul>
        <li><strong>Unverified</strong> — agent is indexed from on-chain data but owner has not proven wallet control</li>
        <li><strong>Verified</strong> (<span style="color:#3b82f6">✓ blue badge</span>) — owner proved wallet control via a signed message — no gas required</li>
        <li><strong>Premium Verified</strong> (<span style="color:#f59e0b">⭐ gold badge</span>) — additional identity verification, priority ranking</li>
      </ul>
      <p>To verify your agent, visit <a href="/verified">agentranking.io/verified</a> and sign with the owning wallet.</p>
      <h2>Verified Revenue</h2>
      <p>The highest trust tier for trading agents: <strong>Verified Revenue</strong>. Agents with this badge have cryptographically linked an execution wallet whose on-chain activity we track. Profile pages show win rate, monthly PnL (USD), total trade volume, and burn-to-earn ratio — all sourced from on-chain data, not self-reported.</p>
      <h2>The Telegram category</h2>
      <p>The <a href="/telegram">Telegram category</a> is unique — it's not ERC-8004 on-chain registrations. It's a curated, indexed directory of <strong>crypto and AI Telegram bots</strong>, including:</p>
      <ul>
        <li><strong>Standalone bots</strong> — traditional Telegram bots with a fixed @username (e.g. @BananaGunSniper_bot)</li>
        <li><strong>Managed Bots</strong> — bots created through Telegram's Managed Bot framework, spawned via a manager bot link</li>
      </ul>
      <p>The catalog is indexed from public sources that indexes public Telegram channels, community directories, and web sources. Verified Telegram bots appear at the top. You can submit your Telegram bot at <a href="/create/telegram-bot">agentranking.io/create/telegram-bot</a>.</p>
      <h2>How to get listed</h2>
      <p>For ERC-8004 on-chain agents, registration is automatic — AgentRanking indexes all supported chains continuously. To claim your listing and get a verification badge, visit <a href="/verified">agentranking.io/verified</a>. To create a custom listing (non-standard agents), visit <a href="/create">agentranking.io/create</a>. For Telegram bots, use <a href="/create/telegram-bot">agentranking.io/create/telegram-bot</a>.</p>
      <h2>Using the public API</h2>
      <p>Agent directory and scoring data is available through the <a href="/docs/api">AgentRanking REST API</a> for programmatic discovery and integration.</p>
    `,
  },
  // ── Existing articles ─────────────────────────────────────────────────────
  {
    slug: "solana-skills-sendai-directory",
    category: "ecosystem",
    title:
      "Solana Skills Explained: The SendAI Agent Skills Directory for Cursor, Claude & Solana Devs",
    excerpt:
      "What Solana Skills is, how it differs from generic AI agent skills, why the Solana Foundation amplified it, and how it fits next to ERC-8004 discovery on AgentRanking.",
    image: "/news/articles/solana-skills-solana-agent-directory.png",
    publishedAt: "2026-04-04T12:00:00Z",
    author: "AgentRanking",
    howToSteps: [
      {
        name: "Open the Solana Skills directory",
        text: "Go to solanaskills.com and search or browse skills by protocol (for example Jupiter, Helius, or Phantom).",
      },
      {
        name: "Pick a skill that matches your task",
        text: "Read the skill description so it matches what you are building—swaps, RPC, wallet connect, NFTs, or a full agent stack.",
      },
      {
        name: "Add the skill to your coding agent",
        text: "Follow the skill’s install path for your tool (Cursor, Claude, Codex, or another compatible agent). Most flows amount to dropping a skill folder or enabling a packaged instruction set.",
      },
      {
        name: "Ground prompts on the skill",
        text: "When you ask for code, reference the skill by name so the model prioritizes its examples and resource links over generic web knowledge.",
      },
      {
        name: "Validate in a devnet or staging project",
        text: "Run transactions against devnet or a sandbox, confirm RPC and key handling, then promote patterns to production.",
      },
    ],
    faq: [
      {
        question: "What is Solana Skills?",
        answer:
          "Solana Skills is a public directory of agent skills curated for the Solana ecosystem. Each skill packages instructions, examples, and resources so coding agents (such as Cursor, Claude, or Codex) integrate Solana protocols with fewer mistakes. The directory lives at solanaskills.com and is maintained by the SendAI team.",
      },
      {
        question: "What are agent skills in this context?",
        answer:
          "Agent skills are structured, reusable context for AI coding tools—not on-chain programs by themselves. They tell the agent which APIs, SDKs, and safety checks matter for a domain (for example Jupiter swaps or Helius RPC). That is separate from ERC-8004, which is an Ethereum standard for on-chain agent identity and reputation.",
      },
      {
        question: "Did the Solana Foundation announce Solana Skills?",
        answer:
          "On April 3, 2026, the Solana Foundation posted on X introducing “Solana Agent Skills,” describing them as pre-built skills you can drop into AI tools to interact with Solana, installable in one line, to build agents that understand the network. Always verify wording against the original post when citing announcements.",
      },
      {
        question: "Is Solana Skills the same as Cursor Skills or Claude skills?",
        answer:
          "They share the same idea—portable instructions for AI assistants—but Solana Skills is a Solana-specific catalog with ecosystem coverage (DEXs, wallets, infra, oracles). Your editor may call the feature “skills,” “rules,” or “plugins”; the value is still curated domain context.",
      },
      {
        question: "Which tools work with Solana Skills?",
        answer:
          "The directory advertises compatibility with Claude, Cursor, Antigravity, Codex, and similar coding agents. Check each skill’s notes for the exact install steps for your stack.",
      },
      {
        question: "How does Solana Skills relate to AgentRanking?",
        answer:
          "Solana Skills helps developers implement Solana integrations in AI-assisted workflows. AgentRanking indexes ERC-8004 and related on-chain AI agents so users can discover, compare, and verify agents after they ship. Skills address building; AgentRanking addresses discovery and trust signals such as verification and feedback.",
      },
      {
        question: "Can I use Solana logos in my own article or app?",
        answer:
          "Use official assets from the Solana Brand & Press page, follow clearspace and color rules, and avoid implying endorsement. Solana and related marks are trademarks of Solana Foundation.",
      },
    ],
    content: `
      <p><strong>Trademark notice:</strong> Solana and the Solana logomark are trademarks of <a href="https://solana.org/" rel="noopener noreferrer">Solana Foundation</a>. Logos below are reproduced from the official <a href="https://solana.com/branding" rel="noopener noreferrer">Brand &amp; Press</a> assets for identification. This article is independent editorial content and is not sponsored by Solana Foundation or SendAI.</p>
      <figure>
        <img src="/branding/solana/solanaLogoMark.svg" alt="Solana logomark (three-bar mark)" width="101" height="88" loading="lazy" />
        <figcaption>Solana logomark — official SVG from solana.com/branding.</figcaption>
      </figure>
      <p>If you are searching for <strong>Solana Skills</strong>, <strong>SendAI Solana Skills</strong>, or <strong>Solana agent skills for Cursor</strong>, you are looking at the same idea: a curated library of instructions that teach coding agents how to work with Solana like a senior Solana engineer would. This guide explains what that library is, why it matters in 2026, how it was amplified by the <strong>Solana Foundation</strong>, and how it sits next to on-chain agent directories such as AgentRanking.</p>
      <h2>What “agent skills” mean in 2026</h2>
      <p>General-purpose models know a lot, but they are not reliably up to date on every RPC quirk, program ID, or deprecated SDK method. <strong>Agent skills</strong> (sometimes called skills, rules, or packs in different products) bundle the missing layer: prioritized documentation patterns, worked examples, and links so the agent reaches for the right tool first. The pattern appears across the industry—Anthropic’s skills concept, Cursor’s skill workflows, and ecosystem-specific directories all push in the same direction: <em>make AI assistants dependable for specialized engineering work</em>.</p>
      <h2>What Solana Skills is</h2>
      <p><a href="https://www.solanaskills.com/" rel="noopener noreferrer">Solana Skills</a> is an <strong>agent skills directory for Solana</strong> maintained by <strong>SendAI</strong>. Each entry is designed to be dropped into compatible AI coding tools so developers get <strong>instructions, examples, and resources</strong> tuned to a protocol or workflow—think Jupiter routing APIs, Helius infrastructure, Phantom wallet connect flows, Metaplex NFT tooling, or end-to-end <strong>solana-agent-kit</strong> patterns for autonomous agents.</p>
      <p>Rather than asking a model to “figure out Solana,” you give it a skill that already encodes the happy paths, failure modes, and official references. That is the practical difference between a generic prompt and a <strong>Solana-specific agent skill</strong>.</p>
      <figure>
        <img src="/branding/solana/solanaWordMark.svg" alt="Solana wordmark" width="180" height="28" loading="lazy" />
        <figcaption>Solana wordmark — official SVG from solana.com/branding.</figcaption>
      </figure>
      <h2>What the Solana Foundation posted on X</h2>
      <p>On <time datetime="2026-04-03">April 3, 2026</time>, <a href="https://x.com/SolanaFndn/status/2040106827786940684" rel="noopener noreferrer">@SolanaFndn on X</a> introduced the initiative in plain language:</p>
      <blockquote cite="https://x.com/SolanaFndn/status/2040106827786940684">
        <p>Introducing Solana Agent Skills</p>
        <p>Pre-built skills you can drop into AI tools to interact with Solana.</p>
        <p>Install in one line and build agents that know Solana.</p>
      </blockquote>
      <p>That framing matters for SEO and for builders: it signals that <strong>AI-assisted Solana development</strong> is a first-class narrative—not a side experiment—and that <strong>one-line install</strong> and <strong>tool interoperability</strong> are explicit goals. When you write tutorials or landing pages, aligning your vocabulary with the Foundation’s (“Solana Agent Skills”) helps readers connect the dots while the ecosystem converges on shared terminology.</p>
      <h2>Example areas covered in the directory</h2>
      <p>The catalog spans protocols and infrastructure rather than a single vendor. Typical buckets include <strong>swap and routing</strong> (for example Jupiter-style aggregation APIs), <strong>RPC and data</strong> (Helius, streaming, webhooks), <strong>wallet and frontend</strong> (Phantom connect SDK patterns), <strong>DeFi primitives</strong> (lending, perps, liquidity venues such as Raydium, Orca, Kamino, Drift—always verify current program interfaces in the skill text), <strong>oracles</strong> (Pyth, Switchboard), <strong>NFTs</strong> (Metaplex), <strong>cross-chain</strong> (deBridge and similar), and <strong>security or auditing workflows</strong> (skills aimed at review and foot-gun avoidance).</p>
      <p>You do not need every skill installed at once. The efficient workflow is to enable the skill that matches your current milestone—RPC setup, swap integration, wallet auth, or a production hardening checklist—then disable noise you are not using.</p>
      <h2>How developers should use Solana Skills day to day</h2>
      <ol>
        <li><strong>Start from the directory</strong> — Search <a href="https://www.solanaskills.com/" rel="noopener noreferrer">solanaskills.com</a> for the protocol or task name.</li>
        <li><strong>Read the skill’s scope</strong> — Confirm it matches your network (mainnet-beta versus devnet) and SDK version.</li>
        <li><strong>Install per your agent</strong> — Cursor, Claude, Codex, and other tools have different mechanics; follow the skill’s documented path.</li>
        <li><strong>Cite the skill in prompts</strong> — A short “Follow the X skill for Jupiter error handling” clause reduces hallucinated endpoints.</li>
        <li><strong>Test like production</strong> — Use devnet or staging, validate signing and fee behavior, then ship.</li>
      </ol>
      <h2>Building versus discovery: Solana Skills and ERC-8004</h2>
      <p><strong>Solana Skills</strong> is about <em>implementation</em>: how an AI-assisted developer ships Solana software correctly. <strong>ERC-8004</strong> is about <em>identity and reputation</em> for AI agents on EVM-family chains—registration, feedback, and discoverability. AgentRanking focuses on the second layer: a <a href="/agents">blockchain AI agent directory</a>, <a href="/ranking">AI agent rankings</a>, and <a href="/verified">Know Your Agent verification</a> so users can trust what they invoke.</p>
      <p>If you build a Solana agent that also registers on an EVM registry, you may use both worlds—<strong>SendAI’s skills</strong> while coding, and <strong>AgentRanking</strong> when you want distribution and trust signals. Our <a href="/docs">documentation</a> covers the <a href="/docs/api">REST API</a> and <a href="/docs/protocol">protocol references</a> for programmatic discovery.</p>
      <figure>
        <img src="/branding/solana/solanaFoundationLogo.svg" alt="Solana Foundation logotype" width="200" height="40" loading="lazy" />
        <figcaption>Solana Foundation logotype — official SVG from solana.com/branding (identification only).</figcaption>
      </figure>
      <h2>SEO checklist for teams publishing around Solana Skills</h2>
      <ul>
        <li>Use clear titles that match intent: “what is Solana Skills,” “SendAI,” “Cursor,” “Solana agent skills.”</li>
        <li>Link to authoritative sources: <a href="https://www.solanaskills.com/" rel="noopener noreferrer">solanaskills.com</a>, the <a href="https://x.com/SolanaFndn/status/2040106827786940684" rel="noopener noreferrer">Solana Foundation announcement</a>, and <a href="https://solana.com/branding" rel="noopener noreferrer">official branding</a> when showing marks.</li>
        <li>Separate <strong>skill packs</strong> (off-chain AI context) from <strong>on-chain agent registries</strong> (identity and reputation) so Google and readers understand the page.</li>
        <li>Ship an FAQ (like this page) so common questions resolve in one crawlable document.</li>
      </ul>
      <h2>Next steps on AgentRanking</h2>
      <p>Shipping a Solana-facing agent? After you harden the integration with <strong>Solana Skills</strong>, <a href="/create">create your listing</a>, <a href="/verified">verify ownership</a>, and make sure your metadata explains endpoints, pricing, and safety boundaries. That is how discovery catches up to implementation.</p>
    `,
  },
  {
    slug: "boost-ai-agent-visibility-2026",
    category: "guides",
    title: "How to Boost Your AI Agent's Visibility in 2026",
    excerpt:
      "Practical ways to get your ERC-8004 agent noticed: verification, rankings, boosts, and promotion—without spamming the timeline.",
    image: "/news/articles/boost-visibility-2026.png",
    publishedAt: "2026-03-28T10:00:00Z",
    author: "AgentRanking",
    contentBeforeList: `
      <p>If you have shipped an on-chain AI agent, you already did the hard part: contracts, endpoints, and metadata. The awkward follow-up is quieter—people have to find you. In 2026 the blockchain AI agent directory space is crowded, so visibility is a skill, not an accident. This guide walks through what actually moves the needle on AgentRanking without turning your launch into noise.</p>
      <h2>Start with trust signals</h2>
      <p>Users compare Ethereum AI agents and Base network AI agents side by side. A <a href="/verified">verified</a> badge is the fastest way to separate a serious builder from a copy-paste listing. Verification ties your wallet to the agent record so visitors know the profile is not a random mirror. It also feeds into how we score and surface verified AI agents across the site.</p>
      <h2>Own your metadata story</h2>
      <p>Thin descriptions hurt more than a low score. Explain what the agent does, which chains it supports, and how to invoke it. Link a working endpoint. Agents with clear service definitions get better engagement, and engagement feeds AI agent rankings over time. Think of the listing as a product page, not a transaction hash with a name.</p>
      <h2>Use boosts and promotion deliberately</h2>
      <p>Organic discovery takes time. When you have a concrete launch window—a new model, a partnership, or a paid feature—<a href="/powerboost">reputation boosts</a> and <a href="/powerboost">promotion packages</a> put you in front of directory traffic that is already looking for ERC-8004 agents. Pair paid visibility with a crisp changelog or demo so visitors convert to users instead of bouncing.</p>
      <p>The agents below are high-signal examples from our live <a href="/ranking">leaderboard</a>—study their descriptions, services, and feedback patterns, then open your own profile and tighten the gaps.</p>
      <h2>Agents worth studying right now</h2>
    `,
    contentAfterList: `
      <h2>Keep momentum after launch</h2>
      <p>Post once with a clear CTA, then invest in documentation and support. Answer feedback, fix broken endpoints quickly, and refresh your listing when you ship meaningful upgrades. Consistency beats a one-day spike every time.</p>
      <p>Ready to explore more? <a href="/agents">Browse the full agent directory</a> for on-chain AI agents across every supported chain, or jump to the <a href="/ranking">AI agent rankings</a> to see who is winning attention this week.</p>
    `,
    agentList: { sort: "score", limit: 6 },
  },
  {
    slug: "erc-8004-vs-traditional-ai-apis",
    category: "protocol",
    title: "ERC-8004 vs Traditional AI APIs: Why On-Chain Agents Are Different",
    excerpt:
      "A developer-friendly comparison: hosted LLM APIs versus ERC-8004 on-chain AI agents for identity, payments, and composability.",
    image: "/news/articles/erc8004-vs-apis.png",
    publishedAt: "2026-03-28T09:30:00Z",
    author: "AgentRanking",
    contentBeforeList: `
      <p>Most teams still integrate AI through a REST key and a rate limit. That model is fine for prototypes. It breaks down when you need accountability, open composability, or user-owned routing across vendors. ERC-8004 agents sit in a different layer: identity and reputation live on-chain, while inference can still run wherever you want.</p>
      <h2>Identity and ownership</h2>
      <p>Traditional APIs hide the operator behind a corporate account. On-chain registration gives each agent a stable identifier per chain, public metadata, and a path for <a href="/verified">wallet-linked verification</a>. That matters when users need to know who they are trusting with prompts, keys, or financial advice.</p>
      <h2>Reputation you cannot delete</h2>
      <p>Off-chain reviews disappear when a vendor pivots. The reputation registry in the ERC-8004 model stores client feedback where the owner cannot silently wipe history. Marketplaces and routers can read those signals to score agents—exactly what we surface in our <a href="/agents">blockchain AI agent directory</a>.</p>
      <h2>Payments and automation</h2>
      <p>Centralized billing is simple until you need micropayments or cross-border usage. Agents can advertise x402 or other payment flows in metadata, then enforce them at the wire protocol. That pairs naturally with autonomous workflows that are awkward to jam into a monthly SaaS invoice.</p>
      <p>Explore high-scoring agents that already combine services, payments, and clear docs—then sketch how your stack would map to the same primitives.</p>
      <h2>Reference implementations in the wild</h2>
    `,
    contentAfterList: `
      <h2>When to stay off-chain</h2>
      <p>If you only need a private copilot with zero public surface area, a classic API is still appropriate. The on-chain path shines when third parties must discover you, verify you, or compose you into their own products.</p>
      <p>Dig into the <a href="/docs">documentation</a> for API and protocol notes, then <a href="/agents">browse verified AI agents</a> to see how shipping teams describe endpoints, pricing, and safety boundaries in practice.</p>
    `,
    agentList: { sort: "score", limit: 5 },
  },
  {
    slug: "what-are-blockchain-ai-agents",
    category: "guides",
    title: "What Are Blockchain AI Agents and How Do They Work?",
    excerpt:
      "A plain-English tour of autonomous software that reads chain state, calls models, and coordinates value—plus where ERC-8004 fits.",
    image: "/news/articles/blockchain-agents-explained.png",
    publishedAt: "2026-03-28T09:00:00Z",
    author: "AgentRanking",
    contentBeforeList: `
      <p>“Blockchain AI agent” sounds like marketing soup until you separate the pieces. At a high level, it is software that can observe on-chain data, call models or tools, and take actions through wallets or contracts—often without a human clicking every step. The chain piece supplies shared state, payments, and audit trails; the AI piece supplies judgment and language.</p>
      <h2>What makes them different from a trading bot?</h2>
      <p>Overlap exists, but agents emphasize general reasoning interfaces—natural language in, structured actions out—while bots are usually hard-coded loops. Agents may chain multiple providers, negotiate payment, or ask for human approval depending on policy. The important part for users is transparency: who operates the agent, and how good is its track record?</p>
      <h2>Where ERC-8004 enters</h2>
      <p>ERC-8004 standardizes how those agents publish identity and collect verifiable feedback. Instead of trusting a landing page, you inspect registry records and <a href="/feedback">on-chain reviews</a>. Directories like AgentRanking aggregate that into searchable AI agent rankings so newcomers are not forced to read raw contract events.</p>
      <h2>How to try one safely</h2>
      <p>Start with read-only tasks, cap spend, and prefer <a href="/verified">verified AI agents</a> when money is involved. Read the agent card, open its services, and check recent feedback before you connect a wallet with meaningful balances.</p>
      <p>These live listings illustrate the pattern end-to-end—from metadata to score to real user signals.</p>
      <h2>See it on real agent pages</h2>
    `,
    contentAfterList: `
      <h2>Looking ahead</h2>
      <p>As tooling improves, expect tighter sandboxes, clearer disclosure of model providers, and richer analytics for operators. The baseline question stays the same: does this on-chain AI agent earn trust through behavior and reputation, not just branding?</p>
      <p>Continue in our <a href="/agents">on-chain AI agents directory</a> or scan the <a href="/ranking">leaderboard</a> for movers and shakers this month.</p>
    `,
    agentList: { sort: "score", limit: 5 },
  },
  {
    slug: "top-on-chain-ai-agents-2026",
    category: "rankings",
    title: "Top On-Chain AI Agents to Watch in 2026",
    excerpt:
      "A curated snapshot of high-scoring ERC-8004 agents across chains—use it as a starting point before you dive into the full directory.",
    image: "/news/articles/top-agents-2026.png",
    publishedAt: "2026-03-28T08:30:00Z",
    author: "AgentRanking",
    contentBeforeList: `
      <p>Ranking noise is easy; ranking signal is harder. We combine metadata quality, endpoint health, feedback volume, and recent activity to highlight on-chain AI agents that are not just deployed but used. The list below refreshes from live data—think of it as a snapshot, not a permanent crown.</p>
      <h2>Why scores move</h2>
      <p>New launches start mid-pack until they prove uptime and user satisfaction. A spike in thoughtful feedback or a verified owner can lift an agent quickly. Conversely, broken endpoints or silent projects drift down. That is intentional: AI agent rankings should reflect behavior, not vanity mints.</p>
      <h2>How to use this list</h2>
      <p>Click through to any card for services, contracts, and reviews. If you are benchmarking your own ERC-8004 agents, note which fields the leaders fill out—especially endpoints, pricing hints, and safety notes. Then open the <a href="/new">new agents</a> feed to see who is shipping weekly.</p>
      <h2>Top picks by composite score</h2>
    `,
    contentAfterList: `
      <p>Lists go stale the moment someone ships an upgrade. For always-on discovery, keep the <a href="/agents">blockchain AI agent directory</a> open in another tab and filter by chain or tag. Serious builders should also watch <a href="/docs/scores-reputation-api">reputation</a> for macro trends.</p>
    `,
    agentList: { sort: "score", limit: 8 },
  },
  {
    slug: "what-is-erc-8004",
    category: "protocol",
    title: "What Is ERC-8004? The Standard Powering On-Chain AI Agents Explained",
    excerpt:
      "ERC-8004 defines on-chain identity and reputation for AI agents. Here is what that means in practice—and where to explore live ERC-8004 agents.",
    faq: [
      {
        question: "What is ERC-8004?",
        answer:
          "ERC-8004 is an Ethereum standard that lets AI agents register on-chain, prove ownership, and build a verifiable reputation. It defines Identity and Reputation registries for trustless AI.",
      },
      {
        question: "How do I discover ERC-8004 agents?",
        answer:
          "AgentRanking indexes agents across Ethereum, Base, Polygon, and other supported chains. Browse the agent directory, check rankings, and read feedback before interacting.",
      },
    ],
    image: "/news/articles/erc-8004-standard.png",
    publishedAt: "2026-03-28T08:00:00Z",
    author: "AgentRanking",
    contentBeforeList: `
      <p>ERC-8004 is the plumbing layer for on-chain AI agents: it tells the world <em>who</em> an agent is, <em>who</em> controls it, and <em>what people experienced</em> when they used it. Instead of trusting a marketing site, you read public registry data and verifiable feedback. That difference matters the moment money, compliance, or safety enters the chat.</p>
      <h2>Two registries, one idea</h2>
      <p>The Identity Registry assigns each deployed agent a chain-scoped <code>agentId</code> and anchors metadata—names, endpoints, URIs—that other apps can fetch. The Reputation Registry stores client feedback where owners cannot quietly delete history. Together they turn “someone on the internet said so” into “here is the on-chain record.”</p>
      <h2>Why builders adopt it</h2>
      <p>Composable routers, wallets, and marketplaces need a stable handle for each agent. ERC-8004 gives that handle plus a path to <a href="/verified">wallet verification</a> so users know the team behind the deployment. It also pairs naturally with payment flows like x402 when agents sell inference per call.</p>
      <h2>What you should do as a user</h2>
      <p>Always open the agent profile, read services, and scan recent <a href="/feedback">feedback</a> before connecting high-value wallets. Prefer <a href="/verified">verified AI agents</a> when you need stronger assurance, and cross-check <a href="/ranking">AI agent rankings</a> for sustained activity—not a one-day spike.</p>
      <p>The agents below illustrate live ERC-8004 registrations with rich metadata; click through to see endpoints, chains, and scores in context.</p>
      <h2>Live ERC-8004 agents to inspect</h2>
    `,
    contentAfterList: `
      <h2>Where AgentRanking fits</h2>
      <p>We aggregate registry data into a searchable blockchain AI agent directory so you are not hand-parsing events in a block explorer. Use filters for chains and tags, then bookmark agents you rely on.</p>
      <p>Continue exploring in the <a href="/agents">full directory of on-chain AI agents</a> or jump to the <a href="/ranking">rankings</a> to see momentum leaders this week.</p>
    `,
    agentList: { sort: "score", limit: 5 },
  },
  {
    slug: "how-to-verify-ai-agent",
    category: "guides",
    title: "How to Verify Your AI Agent on AgentRanking",
    excerpt:
      "Prove wallet control, earn the verified badge, and show up as a trusted ERC-8004 agent across AgentRanking.",
    image: "/news/articles/verify-guide.png",
    publishedAt: "2026-03-27T14:00:00Z",
    author: "AgentRanking",
    howToSteps: [
      { name: "Go to Verify page", text: "Head to the Verify page on AgentRanking." },
      { name: "Connect your wallet", text: "Connect your wallet using RainbowKit, WalletConnect, or MetaMask." },
      { name: "Select your chain", text: "Select the chain where your agent lives (Base, Ethereum, Polygon, etc.)." },
      { name: "Sign to prove ownership", text: "Sign a message to prove ownership. No gas, no transaction—just a signature." },
      { name: "Verification complete", text: "Your agent now shows the verified badge on the agents list, leaderboard, and across AgentRanking." },
    ],
    faq: [
      { question: "I don't see my agent", answer: "We only show agents that we've indexed. If your agent is brand new, give the sync a few minutes. If it's been a while, check that the agent is registered in the official ERC-8004 Identity Registry on your chain." },
      { question: "Verification succeeded but no badge", answer: "Try a hard refresh. If the badge still doesn't show after a minute, something may have failed on our side—reach out and we'll look into it." },
    ],
    contentBeforeList: `
      <p>Verification on AgentRanking ties your wallet to an ERC-8004 identity record. Visitors stop guessing whether a listing is official; they see a badge that maps to an on-chain owner. If you care about conversion—or simply hate impersonators—that signal is worth a few minutes.</p>
      <h2>Prerequisites</h2>
      <p>Use the same wallet that deployed or controls the agent on the correct chain. Multisigs work if a signer can complete the flow. If your team rotated keys, update registry ownership first or verification will fail even when the UI looks fine.</p>
      <h2>Five quick steps</h2>
      <ol>
        <li>Open <a href="/verified">Verify</a> and connect with RainbowKit, WalletConnect, or MetaMask.</li>
        <li>Pick the chain where the agent lives—mixing Base and Ethereum is the most common mistake.</li>
        <li>Select the agent you want to claim; confirm the <code>agentId</code> matches your deployment.</li>
        <li>Sign the ownership message. No gas, no transfers—just a cryptographic proof.</li>
        <li>Refresh the <a href="/agents">directory</a> and <a href="/ranking">leaderboard</a>; the badge should appear alongside your name.</li>
      </ol>
      <h2>After you verify</h2>
      <p>Update your description, add working endpoints, and invite early users to leave honest <a href="/feedback">feedback</a>. Verified AI agents with real usage climb AI agent rankings faster than idle listings.</p>
      <p>Study how top builders present their profiles—then mirror the clarity, not the hype.</p>
      <h2>Examples of strong verified listings</h2>
    `,
    contentAfterList: `
      <h2>Troubleshooting</h2>
      <p>Missing agent? Confirm it appears in the Identity Registry and wait for indexer sync. Badge delayed? Hard refresh; if it persists, contact support with your chain and agent id.</p>
      <p>When you are finished, explore the <a href="/agents">blockchain AI agent directory</a> for peers in your category and compare how they document risk, pricing, and endpoints.</p>
    `,
    agentList: { sort: "score", limit: 4 },
  },
  {
    slug: "top-ai-agents-base-ethereum",
    category: "rankings",
    title: "Top AI Agents on Base and Ethereum (2025)",
    excerpt: "Explore the highest-rated ERC-8004 AI agents on Base and Ethereum based on scores, feedback, and activity.",
    image: "/news/articles/top-ai-agents-base-ethereum.png",
    publishedAt: "2026-01-19T10:00:00Z",
    author: "AgentRanking",
    faq: [
      { question: "How does AgentRanking score agents?", answer: "We combine metadata quality (name, description, working endpoint), service availability, feedback signals, and activity. Verified owners and x402 support get a boost. A high score usually means the agent is well-documented, actually works, and has real users leaving feedback." },
      { question: "What's the difference between Base and Ethereum for AI agents?", answer: "Base tends to attract newer, experimental agents with lower fees. Ethereum hosts more established agents with longer track records and deeper feedback history. Both are indexed—filter by chain on the leaderboard." },
      { question: "Where can I find new or trending agents?", answer: "The New agents page surfaces recently created agents. The Hot section highlights agents with recent feedback and activity—agents people are actually using right now." },
    ],
    content: `
      <p>AgentRanking indexes thousands of ERC-8004 agents across multiple chains. The ecosystem is growing fast—which means finding the good stuff can feel like digging through noise. Here's how we rank agents, where to look, and what actually matters when you're hunting for quality.</p>
      <h2>How We Score Agents</h2>
      <p>Our scores aren't arbitrary. We combine metadata quality (does the agent have a clear name, description, working endpoint?), service availability (can we actually reach it?), feedback signals (what are users saying?), and activity (is anyone using this thing?). Agents with rich metadata, stable endpoints, and positive <a href="/feedback">user feedback</a> climb the ranks. Verified owners get a boost—we treat verification as a trust signal. So does x402 payment support, since it suggests the agent has a real monetization path and isn't just a demo.</p>
      <p>The goal is simple: surface agents that work and that users trust. Gimmicks don't last long in the rankings.</p>
      <h3>Breaking Down the Score</h3>
      <p>Under the hood, we weight several factors: metadata completeness (name, description, services), endpoint reachability, feedback volume and sentiment, recency of activity, and whether the owner is verified. A high score usually means the agent is well-documented, actually works, and has real users leaving feedback. Low scores aren't always bad—new agents start low and climb as they prove themselves.</p>
      <h2>Base vs Ethereum: Where to Look</h2>
      <p>Base has become the go-to chain for a lot of AI agent deployments. Low fees, strong ecosystem support, and a developer-friendly vibe. Ethereum mainnet still hosts plenty of established agents—often ones that have been around longer and have deeper feedback history. The <a href="/ranking">leaderboard</a> lets you filter by chain so you can compare Base and Ethereum head-to-head. Worth doing. Different chains attract different kinds of projects.</p>
      <h3>Base-Specific Tips</h3>
      <p>Base tends to attract newer, experimental agents. Fees are low enough that teams can iterate quickly. Look for agents with recent feedback—that's a signal they're actively maintained. The ecosystem is younger, so top scorers may have less historical data than Ethereum veterans, but the upside is you're often finding agents that are still actively evolving.</p>
      <h3>Ethereum Mainnet</h3>
      <p>On Ethereum, you'll find more established agents with longer track records. Higher gas means deployments are more deliberate. The <a href="/ranking">leaderboard</a> here skews toward agents that have been battle-tested. Good for production use; less experimental than Base.</p>
      <h2>New Agents, Hot Agents, and the Rest</h2>
      <p>Not everything good is at the top of the leaderboard. The <a href="/agents?sort=new">New agents</a> page surfaces recently created agents. Some are rough around the edges and light on feedback—but early movers can rise fast if they deliver. The <a href="/agents?sort=active">Hot</a> section highlights agents with recent feedback and activity. That's where you'll find momentum: agents people are actually using right now.</p>
      <p>Rankings move. New agents launch. Established ones get more feedback. Check back regularly, and don't assume the leaderboard is static. The best agent for your use case might have just shipped.</p>
    `,
  },
  {
    slug: "ai-agents-x402-payments",
    category: "payments",
    title: "AI Agents and x402: Pay-for-Use AI on Chain",
    excerpt: "x402 extends HTTP 402 Payment Required to enable micropayments for AI inference. Learn how ERC-8004 agents can monetize via on-chain payments.",
    image: "/news/articles/ai-agents-x402-payments.png",
    publishedAt: "2026-01-26T16:00:00Z",
    author: "AgentRanking",
    content: `
      <p>HTTP 402 has been sitting in the spec since the 90s—"Payment Required"—but nobody really used it. Until now. x402 brings that idea into Web3: AI agents can require payment before serving a request, with settlement happening on-chain or through payment channels. No Stripe. No PayPal. Just crypto, micropayments, and a direct link between usage and payment.</p>
      <h2>Why This Matters for AI</h2>
      <p>Let's be real: AI inference is expensive. Models need GPUs. APIs cost money. Free tiers get rate-limited or quietly downgraded. Someone has to pay, and that someone is usually you—through subscriptions, through ads, or through your data. x402 flips the model. Agents charge per request. You pay for what you use. No monthly fees, no commitment. Run a query, pay for the query. Simple.</p>
      <p>The catch? It only works if the payment flow stays decentralized. x402 does that. Settlement happens on-chain or via established payment channels. The agent gets paid. The user gets output. No intermediary taking a cut or holding your funds.</p>
      <h2>How x402 Works Under the Hood</h2>
      <p>When you call an x402-enabled agent, the request can return a 402 status. That response includes payment instructions—what to pay, where to send it, and how to prove you paid. You complete the payment on-chain (or through a payment channel), then retry the request with proof. The agent verifies the payment and serves the response. No API key. No subscription. Just pay-per-use.</p>
      <p>Payment channels let you batch many small payments into fewer on-chain transactions, which keeps costs down for high-volume use. For occasional calls, a direct on-chain payment works fine. The protocol is flexible enough to support both.</p>
      <h2>ERC-8004 and x402 Together</h2>
      <p>ERC-8004 agents can declare <code>x402Support</code> in their metadata. We surface that on AgentRanking—agent cards, search results, the works. Agents with x402 support tend to score higher on our "compliance" dimension because they've got a real monetization path. They're not hoping for venture funding or ad revenue; they're built to earn from day one.</p>
      <h2>Examples: What Pay-Per-Use Looks Like</h2>
      <p>Imagine a trading-analysis agent that charges 0.001 ETH per report. You get one report, you pay once. No monthly subscription to a data service. Or a code-review agent: pay per file reviewed. Or a language-model agent that charges per token. The granularity is up to the agent. Users get predictable, usage-based pricing without lock-in.</p>
      <h2>Finding Agents That Take Payments</h2>
      <p>On the <a href="/agents">agents page</a>, filter or sort by x402 support to find agents that accept on-chain payments. The list is growing. As the standard matures and more tooling ships, expect pay-per-call to become the default for serious agent deployments.</p>
      <p>x402 is still early. But it's one of the key pieces of the decentralized AI economy: verifiable agents, verifiable payments, and no centralized payment processor in the middle. That's the direction things are headed.</p>
    `,
  },
  {
    slug: "on-chain-reputation-trust",
    category: "protocol",
    title: "Building Trust with On-Chain Reputation",
    excerpt: "The ERC-8004 Reputation Registry stores feedback on-chain. Discover how on-chain reputation creates accountability for AI agents.",
    image: "/news/articles/on-chain-reputation-trust.png",
    publishedAt: "2026-02-02T09:00:00Z",
    author: "AgentRanking",
    content: `
      <p>Trust is the bottleneck. We've got powerful AI tools, but we don't know which ones to trust. Off-chain reviews get gamed, deleted, or buried. Star ratings get inflated. You're never quite sure if you're looking at honest feedback or astroturf. The ERC-8004 Reputation Registry changes the game: feedback lives on-chain. Permanent. Auditable. Not something the agent owner can wipe away when it gets awkward.</p>
      <h2>How the Reputation Registry Works</h2>
      <p>Every ERC-8004 agent can receive feedback from clients. That feedback includes a numeric value (think 0–100), optional tags like "starred," and can point to off-chain content via URIs—maybe a detailed review or a link to a conversation. The important part: it all goes on-chain. The agent owner can't unilaterally delete it. They can't pay a platform to bury bad reviews. What gets submitted stays.</p>
      <p>Feedback is tied to wallet addresses. You can trace who said what. Over time, agents accumulate a real trust history—one that any user can verify by reading the chain. No need to trust a corporate database. No need to hope the platform isn't hiding something.</p>
      <h2>What Good Feedback Looks Like</h2>
      <p>Quality feedback helps everyone. A numeric score (e.g. 80/100) gives a quick signal. Tags like "starred" or "helpful" add nuance. Optional URIs can link to longer reviews or conversation logs. The more specific the feedback, the more useful it is for others. "Worked perfectly" is fine; "Fast response, accurate analysis for ETH price prediction" is better. Both contribute to the aggregate score.</p>
      <h2>Reading the Signals</h2>
      <p>When evaluating an agent, look at more than the raw score. How many people left feedback? A 95 from 2 users is less reliable than an 85 from 50. Check the <a href="/feedback">Feedback</a> page for recent submissions—is the agent getting new feedback, or has it gone quiet? Verified owners plus consistent positive feedback is a strong combo. Lots of feedback with a middling score might mean the agent is good but not great, or that it divides opinion. Use your judgment.</p>
      <h2>How We Use It</h2>
      <p>When a user interacts with an agent, they can submit feedback to the Reputation Registry. AgentRanking syncs that feedback and folds it into our agent scores. You can browse everything on our <a href="/feedback">Feedback</a> page and see aggregate scores on each agent's detail page. The more feedback an agent gets, the more reliable the signal.</p>
      <h2>Why On-Chain Beats Off-Chain</h2>
      <p>Off-chain reviews can be gamed. Companies buy fake reviews. Competitors leave fake negative ones. Platforms tweak algorithms. With on-chain reputation, the data is there. Anyone can audit it. Combined with <a href="/verified">verification</a>—proving who owns the agent—you get a trust layer that's actually hard to manipulate.</p>
      <p>As more users leave feedback, the <a href="/ranking">leaderboard</a> becomes a better signal. So if you use an agent and have an opinion: leave feedback. You're helping the whole ecosystem figure out what works.</p>
    `,
  },
  {
    slug: "top-ai-crypto-agents-2025",
    category: "rankings",
    title: "Top 10 AI Crypto Agents of 2025",
    excerpt: "Live rankings of the highest-scored ERC-8004 AI agents across all chains. Updated hourly from AgentRanking.",
    image: "/news/articles/top-ai-crypto-agents-2025.png",
    publishedAt: "2026-02-05T10:00:00Z",
    author: "AgentRanking",
    contentBeforeList: `
      <p>Looking for the best AI crypto agents? You've come to the right place. Below are the top 10 ERC-8004 agents by score, based on metadata quality, service availability, user feedback, and activity across all supported chains. These rankings update regularly as new agents launch and existing ones collect more feedback.</p>
      <p>Each agent is ranked by our composite score, which weighs trust signals (verification, feedback volume), technical reliability (working endpoints, metadata completeness), and engagement (stars, recent activity). Click through to any agent for full details, feedback history, and links to interact.</p>
      <h2>Top 10 AI Crypto Agents (Live Rankings)</h2>
    `,
    contentAfterList: `
      <p>Rankings shift as the ecosystem grows. New agents climb the ladder. Established ones get more feedback and refine their services. Use the <a href="/ranking">leaderboard</a> to see the full ranking, filter by chain, and discover agents by score, feedback count, or recency. The <a href="/agents">agent directory</a> lets you search, sort, and explore the full catalog.</p>
      <p>Found an agent you like? Leave <a href="/feedback">feedback</a> after you use it. Your input makes these rankings more useful for everyone.</p>
    `,
    agentList: { sort: "score", limit: 10 },
  },
  {
    slug: "best-ai-agents-on-base",
    category: "rankings",
    title: "Best AI Agents on Base Chain",
    excerpt: "The highest-rated ERC-8004 AI agents on Base. Low fees, strong ecosystem, and a growing roster of verified agents.",
    image: "/news/articles/best-ai-agents-on-base.png",
    publishedAt: "2026-02-06T12:00:00Z",
    author: "AgentRanking",
    contentBeforeList: `
      <p>Base has become the go-to chain for ERC-8004 AI agent deployments. Low gas, strong Coinbase ecosystem support, and a developer-friendly L2 make it ideal for teams iterating on AI agents. Here are the best-ranked AI agents on Base right now.</p>
      <p>These agents are sorted by our composite score, which combines metadata quality, service availability, user feedback, and activity. Base agents tend to be newer and more experimental than Ethereum mainnet—check feedback and descriptions to find the right fit.</p>
      <h2>Best AI Agents on Base</h2>
    `,
    contentAfterList: `
      <p>Base is growing fast. New agents appear weekly. Use the <a href="/ranking">leaderboard</a> with the Base filter to see the full ranking, or browse all Base agents in the <a href="/agents">directory</a>. Building an agent? <a href="/create">Create</a> on Base and get it listed. Then <a href="/verified">verify</a> ownership to earn the trusted badge.</p>
    `,
    agentList: { sort: "score", limit: 10, chainId: 8453 },
  },
  {
    slug: "best-ai-agents-ethereum",
    category: "rankings",
    title: "Best AI Agents on Ethereum",
    excerpt: "Top ERC-8004 AI agents on Ethereum mainnet. Established track records, deep feedback history, and production-ready services.",
    image: "/news/articles/best-ai-agents-ethereum.png",
    publishedAt: "2026-02-07T09:00:00Z",
    author: "AgentRanking",
    contentBeforeList: `
      <p>Ethereum mainnet hosts many of the most established ERC-8004 agents. Higher deployment costs mean teams tend to be more deliberate—what you find here often has longer track records and deeper feedback history. Below are the top AI agents on Ethereum by score.</p>
      <p>Ethereum agents are well-suited for production use and high-stakes applications where you want a proven track record. Verification and feedback volume matter more here than on younger chains.</p>
      <h2>Best AI Agents on Ethereum</h2>
    `,
    contentAfterList: `
      <p>Compare Ethereum agents with <a href="/ranking">Base</a> and other chains using the leaderboard filter. For the full Ethereum catalog, head to the <a href="/agents">agent directory</a> and filter by chain. Want to create an agent? See our <a href="/create">create guide</a> for getting your agent on Ethereum.</p>
    `,
    agentList: { sort: "score", limit: 10, chainId: 1 },
  },
  {
    slug: "top-x402-ai-agents",
    category: "payments",
    title: "Top x402 AI Agents: Pay-Per-Use Crypto AI",
    excerpt: "ERC-8004 AI agents that accept on-chain payments via x402. Pay per request, no subscriptions, no lock-in.",
    image: "/news/articles/top-x402-ai-agents.png",
    publishedAt: "2026-02-08T14:00:00Z",
    author: "AgentRanking",
    contentBeforeList: `
      <p>x402 enables pay-per-request AI. No subscriptions. No API keys with monthly limits. Just crypto payments per use. The agents below support x402—they can require payment before serving a request, with settlement on-chain or via payment channels.</p>
      <p>These are the highest-scored x402 agents. We rank them by the same criteria as other agents: metadata, availability, feedback, and activity. x402 support is a plus for "compliance" in our scoring, since it signals a real monetization path.</p>
      <h2>Top x402 AI Agents</h2>
    `,
    contentAfterList: `
      <p>Want more? Filter the <a href="/agents">agents page</a> by x402 support to see the full list. New x402 agents are shipping regularly as the protocol matures. For the big picture on pay-per-use AI, read our <a href="/news/ai-agents-x402-payments">x402 and AI agents guide</a>.</p>
    `,
    agentList: { sort: "score", limit: 10, x402: true },
  },
  {
    slug: "newest-erc-8004-agents",
    category: "ecosystem",
    title: "Newest ERC-8004 Agents to Watch",
    excerpt: "Recently launched AI agents on the ERC-8004 standard. Early movers, fresh deployments, and agents just getting started.",
    image: "/news/articles/newest-erc-8004-agents.png",
    publishedAt: "2026-02-09T11:00:00Z",
    author: "AgentRanking",
    contentBeforeList: `
      <p>New agents ship every week. Some are experiments. Some are production-ready from day one. The list below shows the most recently created ERC-8004 agents. They may not have deep feedback yet—that's the tradeoff. You're seeing what's fresh.</p>
      <p>New doesn't mean unvetted. Check descriptions, endpoints, and whatever feedback exists. Early adopters can discover gems before they hit the top of the leaderboard. Use the <a href="/agents">agents page</a> sorted by "newest" for the full stream.</p>
      <h2>Newest ERC-8004 Agents</h2>
    `,
    contentAfterList: `
      <p>The ecosystem moves fast. Bookmark the <a href="/agents">agents directory</a> and filter by newest to stay on top of launches. Building something? <a href="/create">Create your agent</a> and get it in front of users. Then <a href="/verified">verify</a> and build your reputation.</p>
    `,
    agentList: { sort: "created", limit: 10 },
  },
  {
    slug: "binance-agent-skills-erc8004",
    category: "ecosystem",
    title: "Binance AI Agent Skills: What It Means for ERC-8004 Projects",
    excerpt: "Binance launched 7 AI agent capabilities in March 2026. Here's how ERC-8004 on-chain AI agents can leverage Binance AI Agent Skills to unlock new use cases in crypto.",
    image: "/news/articles/binance-agent-skills-erc8004.png",
    publishedAt: "2026-03-10T10:00:00Z",
    author: "AgentRanking",
    faq: [
      { question: "What are Binance AI Agent Skills?", answer: "Binance AI Agent Skills is a framework launched in March 2026 that defines 7 standardized capabilities for AI agents operating in the crypto ecosystem: Market Data, Trade Execution, Portfolio Analytics, Risk Management, DeFi Bridge, Token Research, and Social Intelligence." },
      { question: "Can any ERC-8004 agent become Binance compatible?", answer: "Yes. Any ERC-8004 agent can declare Binance compatibility by implementing one or more of the 7 skills and registering the supported skills in their on-chain metadata. AgentRanking automatically detects and displays the Binance Compatible badge." },
      { question: "How do I list my Binance-compatible agent on AgentRanking?", answer: "Register your agent on any supported chain using the ERC-8004 standard, add a 'binanceSkills' metadata entry listing which skills you support, and AgentRanking will index it automatically. You can also verify ownership from the Agent Dashboard for an additional trust signal." },
    ],
    content: `
      <p>In March 2026, Binance rolled out AI Agent Skills—a framework that defines seven standardized capabilities for AI agents operating in crypto. It's a significant move. The world's largest exchange isn't just watching the AI agent space evolve; it's setting the playbook for how agents interact with trading infrastructure, DeFi protocols, and market intelligence. For projects building on ERC-8004, this opens real doors.</p>
      <h2>The 7 Binance AI Agent Capabilities</h2>
      <p>Binance AI Agent Skills covers seven distinct areas. Each one maps to a specific type of work that crypto-native AI agents need to perform. Here's what shipped:</p>
      <h3>1. Market Data</h3>
      <p>Real-time price feeds, OHLCV candles, order book snapshots, and ticker data across Binance's full asset catalog. Agents can pull live market state without scraping or relying on third-party aggregators. For on-chain AI agents that need to make decisions based on current prices—think trading bots, arbitrage agents, or portfolio rebalancers—this is foundational.</p>
      <h3>2. Trade Execution</h3>
      <p>Spot and futures order management through a standardized interface. Agents can place, modify, and cancel orders programmatically. The skill handles order types (market, limit, stop-limit), position sizing, and execution confirmation. This is the capability that turns an analytical agent into one that can actually act on its insights.</p>
      <h3>3. Portfolio Analytics</h3>
      <p>Portfolio tracking, P&L calculations, asset allocation breakdowns, and historical performance analysis. Agents with this skill can provide users with a clear picture of their holdings across Binance accounts—useful for advisory agents, tax reporting tools, and wealth management bots.</p>
      <h3>4. Risk Management</h3>
      <p>Risk scoring, automated stop-loss logic, exposure monitoring, and drawdown alerts. This skill lets agents enforce risk parameters on behalf of users. An agent could, for example, automatically reduce position sizes when portfolio volatility exceeds a threshold, or alert users when correlation risk spikes.</p>
      <h3>5. DeFi Bridge</h3>
      <p>Cross-chain swaps, liquidity provision, and bridge operations via BNB Chain and connected networks. Agents can move assets between chains, provide liquidity to DEXs, and interact with DeFi protocols—all through Binance's infrastructure. For ERC-8004 agents deployed on Ethereum or Base, this creates a bridge into the BNB ecosystem without leaving the agent framework.</p>
      <h3>6. Token Research</h3>
      <p>Fundamental analysis, tokenomics evaluation, on-chain metrics, and project due diligence. Agents with this skill can assess new listings, analyze token supply dynamics, and flag suspicious contract patterns. It's the research layer that feeds into smarter trading and investment decisions.</p>
      <h3>7. Social Intelligence</h3>
      <p>Sentiment analysis from social media platforms, news aggregation, and trend detection. This skill processes the firehose of crypto Twitter, Telegram groups, and news feeds to extract actionable signals. Agents can gauge market sentiment, detect narrative shifts, and identify early buzz around projects before it hits the charts.</p>
      <h2>What This Means for ERC-8004 Agents</h2>
      <p>ERC-8004 already gives AI agents a verifiable on-chain identity, ownership proof, and a reputation system. Binance AI Agent Skills adds a standardized capability layer on top. The combination is powerful: you get agents that are not only trustworthy and accountable (thanks to ERC-8004) but also capable of interacting with the deepest liquidity pool in crypto.</p>
      <p>Here's the practical picture. An ERC-8004 agent registered on Base can declare Binance compatibility in its metadata. AgentRanking picks that up and shows a "Binance Compatible" badge on the agent's profile, along with a breakdown of which skills it supports. Users filtering the <a href="/agents">agent directory</a> can now toggle "Binance Compatible" to find agents that plug into Binance's infrastructure.</p>
      <h2>How ERC-8004 Agents Can Leverage These Skills</h2>
      <p>The integration path is straightforward. Agents declare which Binance skills they support in their on-chain metadata using a <code>binanceSkills</code> field. The value is a JSON array of skill identifiers: <code>["market_data", "trade_execution", "portfolio_analytics"]</code>, for example. Agents that implement the corresponding APIs can serve requests that leverage Binance's data and execution layer.</p>
      <p>Some natural combinations for ERC-8004 agents:</p>
      <ul>
        <li><strong>Trading agents</strong> that combine Market Data + Trade Execution + Risk Management. Analyze the market, execute trades, and enforce risk limits—all in one composable agent.</li>
        <li><strong>Research agents</strong> pairing Token Research + Social Intelligence. Deep fundamental analysis augmented by real-time sentiment signals.</li>
        <li><strong>Portfolio management agents</strong> using Portfolio Analytics + DeFi Bridge. Track holdings and rebalance across chains.</li>
        <li><strong>Full-stack investment agents</strong> supporting all seven skills. The holy grail: a single agent that can research, analyze, trade, manage risk, bridge assets, and monitor sentiment.</li>
      </ul>
      <p>The key advantage of doing this through ERC-8004: every interaction, every piece of feedback, every trust signal gets recorded on-chain. Users aren't trusting a random API—they're trusting an agent with a verifiable track record.</p>
      <h2>On-Chain AI Agents in 2026: Where Things Stand</h2>
      <p>The convergence of on-chain AI agents and centralized exchange infrastructure was inevitable. Binance bringing structured capabilities to the table validates what the ERC-8004 ecosystem has been building toward: AI agents as first-class participants in crypto markets. Not toys. Not demos. Agents that trade, analyze, and manage real capital with verifiable identity and accountability.</p>
      <p>We're still early. Most agents today implement one or two Binance skills at best. But the framework is there, and the agents that move first—building real integrations, accumulating feedback, and proving their value—will have a meaningful head start as the ecosystem matures.</p>
      <h2>List Your Agent on AgentRanking</h2>
      <p>Building an AI agent with Binance AI Agent Skills? <a href="/create">Create it on-chain</a> using ERC-8004, <a href="/verified">verify ownership</a>, and it'll appear in the AgentRanking directory automatically. Add your <code>binanceSkills</code> metadata and we'll show the compatibility badge and skill breakdown on your agent's profile. Already listed? Update your metadata to declare Binance compatibility and the badge appears on next sync.</p>
      <p>The <a href="/agents?binanceCompatible=true">Binance-compatible agents directory</a> is live. Browse, filter, and discover agents that are plugged into the world's largest exchange. The on-chain AI agent era isn't coming—it's here.</p>
    `,
  },
  {
    slug: "how-to-choose-on-chain-ai-agent",
    category: "guides",
    title: "How to Choose an On-Chain AI Agent (Without Getting Rekt)",
    excerpt:
      "A practical checklist for evaluating ERC-8004 and Solana-listed agents: verification, endpoints, payments, and what AgentRanking scores actually mean.",
    image: "/news/articles/how-to-choose-on-chain-ai-agent.png",
    publishedAt: "2026-04-08T10:00:00Z",
    author: "AgentRanking",
    howToSteps: [
      {
        name: "Confirm identity signals",
        text: "Open the agent profile and check verification tier, registry chain, and whether the owner completed AgentRanking’s ownership flow—not just a pretty logo.",
      },
      {
        name: "Read services and limits",
        text: "Inspect declared MCP/A2A or HTTP services, rate limits, and pricing. Missing or broken documentation is a red flag for production use.",
      },
      {
        name: "Scan feedback and activity",
        text: "Use on-profile feedback and any wallet-linked activity panels as hints, remembering both can lag or use heuristics—never the full risk picture.",
      },
      {
        name: "Match payment rails",
        text: "If you need micropayments, filter for x402-capable agents; if you need subscriptions, confirm the agent documents off-chain billing honestly.",
      },
      {
        name: "Start with dry runs",
        text: "Test on devnet, small notional sizes, or read-only calls before granting broad wallet permissions or API keys.",
      },
    ],
    faq: [
      {
        question: "Does a high AgentRanking score mean an agent is safe?",
        answer:
          "No. Scores rank discoverability signals—metadata, feedback, verification, optional activity—not smart contract audits or investment suitability.",
      },
      {
        question: "Should I trust performance numbers on a profile?",
        answer:
          "Treat them as directional unless explicitly labeled as audited. Verified-revenue and wallet-activity views use pipelines and heuristics with documented limitations.",
      },
    ],
    content: `
      <p>On-chain agents are marketed aggressively. The antidote is a boring checklist: identity, endpoints, economics, and evidence. AgentRanking exists to shorten that homework, not replace it.</p>
      <h2>Start with what you are optimizing for</h2>
      <p>Trading automation, research bots, and paid APIs have different failure modes. Write down chain, budget, latency, and whether you need micropayments. That single sentence eliminates most mismatched listings before you read a paragraph of marketing copy.</p>
      <h2>Use the directory as triage, not prophecy</h2>
      <p>Our rankings compress many signals into one score so you can sort quickly. Compression loses nuance—an experimental agent with great ideas might score lower than a stale but well-documented deployment. Click through, read services, and verify endpoints yourself.</p>
      <p>When you are ready to compare live registrations, open the <a href="/agents">agent directory</a> and cross-check <a href="/verified">verified agents</a> for ownership proofs.</p>
    `,
  },
  {
    slug: "erc-8004-agent-registry-explained",
    category: "protocol",
    title: "ERC-8004 Agent Registry Explained: Identity, Reputation, and Discovery",
    excerpt:
      "How Identity and Reputation registries work for AI agents—and how AgentRanking turns registry data into searchable listings.",
    image: "/news/articles/erc-8004-agent-registry-explained.png",
    publishedAt: "2026-04-08T14:30:00Z",
    author: "AgentRanking",
    faq: [
      {
        question: "Is AgentRanking the ERC-8004 registry?",
        answer:
          "No. Registries live on-chain per chain deployment. AgentRanking indexes them and adds directory features like search, archetypes, feedback surfacing, and optional performance overlays.",
      },
      {
        question: "Can an agent exist on multiple chains?",
        answer:
          "Yes. Publishers often deploy the same agent on multiple EVM chains. AgentRanking merges related deployments into one profile with a chain switcher when metadata, fingerprint, or owner/URI signals match. Chain verified (ERC-8004 Validation Registry) is separate from AgentRanking wallet verification.",
      },
      {
        question: "Where do reputation signals come from?",
        answer:
          "From the Reputation registry pattern plus AgentRanking user feedback. We surface both where available so history is harder to fake than a static website testimonial.",
      },
    ],
    content: `
      <p>ERC-8004 standardizes how agents declare themselves on-chain. Think of it as DNS plus a guestbook: a canonical id, pointers to metadata, and a place for clients to leave verifiable reviews.</p>
      <h2>Identity registry: the handle</h2>
      <p>Deployments allocate an <code>agentId</code> scoped to a chain. Metadata URIs describe capabilities, endpoints, and presentation. AgentRanking ingests those records so you can search across Ethereum, Base, Polygon, and other supported networks from one UI.</p>
      <h2>Reputation registry: the trail</h2>
      <p>Feedback anchored on-chain resists silent edits. We expose that history alongside in-app reviews so users see both protocol-level attestations and community sentiment.</p>
      <h2>What AgentRanking adds</h2>
      <p>We layer archetype classification, scoring, duplicate-name warnings, optional x402 badges, and wallet-linked activity summaries when publishers opt in. None of that replaces reading the raw registry—power users can still verify contracts in a block explorer—but most people start with <a href="/new">curated discovery</a>.</p>
    `,
  },
  {
    slug: "solana-vs-ethereum-on-chain-ai-agents",
    category: "ecosystem",
    title: "Solana vs Ethereum On-Chain AI Agents: How Discovery Differs on AgentRanking",
    excerpt:
      "Same directory product, different execution environments: what changes for agents on Solana (synthetic chain id 900001) versus EVM registries.",
    image: "/news/articles/solana-vs-ethereum-on-chain-ai-agents.png",
    publishedAt: "2026-04-09T09:00:00Z",
    author: "AgentRanking",
    faq: [
      {
        question: "Why does Solana use chain id 900001 in AgentRanking URLs?",
        answer:
          "Solana is not EVM. We use a stable synthetic id so routes and APIs stay consistent across chains. Under the hood the data maps to Solana registry programs.",
      },
      {
        question: "Are scores comparable across Solana and Ethereum agents?",
        answer:
          "They use the same ranking philosophy, but underlying activity metrics may rely on different providers. Compare within-chain when judging fine-grained performance.",
      },
    ],
    content: `
      <p>Builders still argue L1 vs L2 vs Solana on Twitter; operators just need to know where an agent lives and how to validate it. AgentRanking lists both ecosystems with explicit chain context so you do not confuse a Base deployment with a Solana program.</p>
      <h2>EVM agents</h2>
      <p>Ethereum, Base, Arbitrum, and siblings share the familiar numeric chain id. Registry addresses follow the ERC-8004 deployment pattern AgentRanking tracks per network. Wallet linking for activity heuristics typically flows through EVM wallet APIs.</p>
      <h2>Solana agents</h2>
      <p>Solana registrations reference program accounts rather than the same contract addresses as Ethereum. We still expose trust scores, verification, and optional activity when publishers connect compatible wallets. Latency and fee dynamics differ—factor that into automation design.</p>
      <h2>Practical takeaway</h2>
      <p>Pick the chain that matches your custody and integration stack, then use <a href="/networks">network hubs</a> to browse agents for that environment only. Cross-chain marketing is common; on-chain proofs are not automatic.</p>
    `,
  },
  {
    slug: "agentranking-trust-score-how-it-works",
    category: "guides",
    title: "How AgentRanking Trust and Directory Scores Work",
    excerpt:
      "Transparency post: what goes into listing scores, what does not, and how to interpret verification, x402, and performance chips.",
    image: "/news/articles/agentranking-trust-score-how-it-works.png",
    publishedAt: "2026-04-09T15:00:00Z",
    author: "AgentRanking",
    faq: [
      {
        question: "Do you manually pick winners?",
        answer:
          "No manual favorites. Scores are computed from registration metadata, availability signals, feedback volume and quality, verification tiers, optional x402 flags, and optional wallet-linked activity or verified-revenue pipelines.",
      },
      {
        question: "Why did my score drop after an update?",
        answer:
          "Endpoint checks, feedback sentiment, or stale metadata can move rankings. Review your services and documentation after major releases.",
      },
      {
        question: "Is a high score legal or investment advice?",
        answer:
          "Absolutely not. Scores are informational rankings inside our directory, not endorsements, audits, or suitability judgments.",
      },
    ],
    content: `
      <p>Directories die when their ranking secret sauce feels arbitrary. Here is the non-mystery version: we reward complete, reachable, and well-used agents; we penalize empty shells and broken endpoints.</p>
      <h2>Inputs we actually use</h2>
      <p>Metadata completeness (name, description, services), health of declared endpoints, user feedback, verification badges, optional x402 support, and—when enabled—wallet-derived activity summaries or verified-revenue metrics. Each input is noisy alone; together they approximate seriousness.</p>
      <h2>What we explicitly do not do</h2>
      <p>We do not run paid placement inside organic rankings, audit smart contracts for exploit risk, or guarantee returns. A verified owner can still ship buggy code; a high score does not mean “SEC approved.”</p>
      <h2>For builders who want to climb</h2>
      <p>Ship honest docs, keep endpoints alive, invite substantive feedback, and <a href="/verified">verify ownership</a>. If you monetize per request, document your x402 flow so users understand pricing.</p>
    `,
  },
  {
    slug: "x402-vs-subscription-for-ai-agents",
    category: "payments",
    title: "x402 vs Subscriptions for AI Agents: Which Payment Story Fits Your Product?",
    excerpt:
      "Compare pay-per-use crypto settlements with SaaS-style billing for agent APIs—and how AgentRanking surfaces x402-capable listings.",
    image: "/news/articles/x402-vs-subscription-for-ai-agents.png",
    publishedAt: "2026-04-10T11:00:00Z",
    author: "AgentRanking",
    faq: [
      {
        question: "Does AgentRanking handle payments?",
        answer:
          "No. We index metadata that declares x402 compatibility so users can find agents that support pay-per-use flows implemented by the publisher.",
      },
      {
        question: "Can an agent support both x402 and subscriptions?",
        answer:
          "Yes. Declare what is true in your documentation and metadata. Mislabeled payment rails erode trust faster than missing features.",
      },
    ],
    content: `
      <p>x402 shines when callers want metered access without storing card data. Subscriptions still win when customers expect seats, SLAs, and consolidated invoices. Agents can mix models, but users should not have to guess.</p>
      <h2>When x402 is the right default</h2>
      <p>Micropayments, anonymous or wallet-native callers, and burst workloads map cleanly to per-request settlement. AgentRanking highlights x402 so those agents surface in intent-driven searches alongside the <a href="/news/ai-agents-x402-payments">x402 explainer</a>.</p>
      <h2>When subscriptions still matter</h2>
      <p>Enterprise procurement, chargebacks, and finance teams often demand traditional billing. That is fine—just be explicit in your profile so directory users know which door to open.</p>
      <h2>Discovery tip</h2>
      <p>Filter the <a href="/agents">agents page</a> for x402 support when you want crypto-native metering; read each agent’s pricing section before you integrate.</p>
    `,
  },
];
export function getArticleBySlug(slug: string): NewsArticle | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}
export function getAllArticleSlugs(): string[] {
  return ARTICLES.map((a) => a.slug);
}
export const CATEGORY_LABELS: Record<ArticleCategory, string> = {
  protocol: "Protocol",
  guides: "Guides",
  mcp: "MCP",
  telegram: "Telegram",
  payments: "Payments",
  rankings: "Rankings",
  ecosystem: "Ecosystem",
};
