import {
  MEDUSA_DOCS_URL,
  MEDUSA_PARTNER_SLUG,
  MEDUSA_WEBSITE_URL,
} from "@/lib/medusa/config";
export const MEDUSA_PARTNER_NAME = "Medusa";
export const MEDUSA_CHAIN = "Solana";
export const MEDUSA_TAGS = [
  "ZK",
  "Solana",
  "x402",
  "Passport",
  "Reputation",
  "Privacy",
] as const;
export const MEDUSA_CAPABILITIES = [
  "Private wallet reputation",
  "ZK eligibility proofs",
  "Passport-based access gating",
  "Anti-sybil campaign registration",
  "x402 USDC passport minting",
] as const;
export const MEDUSA_INTEGRATION_STATUS = "Indexed / exploratory";
export const MEDUSA_DESCRIPTION =
  "Privacy layer for Solana wallet reputation. Medusa lets wallets prove they are real and active without exposing full wallet history, balances, or transaction graphs.";
export const MEDUSA_TAGLINE =
  "ZK wallet reputation and Medusa Passports for private eligibility on Solana.";
export const MEDUSA_HIGHLIGHTS = [
  "Medusa Passports use zero-knowledge proofs so wallets can prove reputation without revealing full transaction history.",
  "Passports can be minted with x402 USDC flows, aligning with agent commerce rails already surfaced on AgentRanking.",
  "Partners use passports for access gating, whitelists, anti-sybil registration, and eligibility checks.",
] as const;
export type MedusaPartnerSection = {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
};
export const MEDUSA_PARTNER_SECTIONS: readonly MedusaPartnerSection[] = [
  {
    title: "What is Medusa?",
    paragraphs: [
      "Medusa is a privacy layer for Solana wallet reputation. Wallets can mint a Medusa Passport using ZK proofs and x402 USDC, then share eligibility signals with partners without exposing balances, full wallet history, or transaction graphs.",
    ],
  },
  {
    title: "Why it matters for agents",
    paragraphs: [
      "Agents and apps increasingly need to distinguish real, active wallets from sybil or throwaway accounts — without turning every flow into a full on-chain KYC surface. Medusa Passports offer a portable, privacy-preserving credential that agents can reference when gating jobs, campaigns, or high-trust actions.",
    ],
    bullets: [
      "Reduce sybil risk for bounties, whitelists, and premium agent features.",
      "Keep wallet history private while still proving baseline reputation.",
      "Composable with x402-paid agent services already indexed on AgentRanking.",
    ],
  },
  {
    title: "Potential AgentRanking use cases",
    paragraphs: [
      "AgentRanking is exploring how declared Medusa Passport support can complement existing trust signals (SAP, verification, x402, partner indexes). Possible directions include:",
    ],
    bullets: [
      "Surfacing which agents declare Medusa Passport eligibility requirements.",
      "Campaign or jobs flows that recommend passport-backed wallets.",
      "Tier-aware gating once live passport verification ships.",
      "Richer partner trust rows when Medusa verification APIs are integrated.",
    ],
  },
  {
    title: "Current integration status",
    paragraphs: [
      `Status: ${MEDUSA_INTEGRATION_STATUS}. Medusa is listed as an ecosystem partner with documentation, owner-declared metadata, and optional wallet passport verification via the Medusa SDK.`,
      "Wallet verification stores tier and timestamp on the agent — not the full passport JSON. Declaration alone still shows as “Declared”; SDK verification shows as “Verified”.",
    ],
  },
] as const;
export const MEDUSA_DOCS_PARTNER_FIELDS = {
  slug: MEDUSA_PARTNER_SLUG,
  name: MEDUSA_PARTNER_NAME,
  description: MEDUSA_DESCRIPTION,
  tagline: MEDUSA_TAGLINE,
  category: "ecosystem" as const,
  chain: MEDUSA_CHAIN,
  tags: MEDUSA_TAGS,
  capabilities: MEDUSA_CAPABILITIES,
  website: MEDUSA_WEBSITE_URL,
  docsUrl: MEDUSA_DOCS_URL,
  integrationStatus: MEDUSA_INTEGRATION_STATUS,
  highlights: MEDUSA_HIGHLIGHTS,
};
