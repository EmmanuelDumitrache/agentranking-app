import { HATCHER_LOGO_SRC } from "@/lib/hatcher/urls";
import { METAPLEX_LOGO_SRC } from "@/lib/metaplex/urls";
import { getOobeSynapseReferralUrl } from "@/lib/oobe-synapse-referral-config";
import { getAppProductSiteUrl } from "@/lib/site-url";
const APP_URL = getAppProductSiteUrl();
export type PublicSitePartnerLink = {
  readonly href: string;
  readonly label: string;
  readonly external?: boolean;
};
export type PublicSitePartnerStatus = "live" | "partner" | "indexed" | "in_progress" | "coming_soon";
export type PublicSitePartner = {
  readonly id: string;
  readonly name: string;
  readonly src: string;
  readonly label: string;
  readonly partnerType: string;
  readonly text: string;
  readonly status: PublicSitePartnerStatus;
  readonly className: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly links: readonly PublicSitePartnerLink[];
};
function oobeSynapseReferralLink(): PublicSitePartnerLink | undefined {
  try {
    const href = getOobeSynapseReferralUrl();
    if (!href.startsWith("http")) return undefined;
    return { href, label: "Synapse referral", external: true };
  } catch {
    return undefined;
  }
}
function oobeLinks(): readonly PublicSitePartnerLink[] {
  const referral = oobeSynapseReferralLink();
  return [
    { href: "https://explorer.oobeprotocol.ai", label: "OOBE explorer", external: true },
    ...(referral ? [referral] : []),
  ];
}
export const PUBLIC_SITE_PARTNERS: readonly PublicSitePartner[] = [
  {
    id: "xona",
    name: "Xona",
    src: "/news/articles/xona-agent-logo.png",
    label: "Ecosystem listing partner",
    partnerType: "Partner feed",
    status: "partner",
    text: "Partner launches connect to directory distribution and ecosystem signal.",
    className: "h-8 w-8 max-h-8 object-contain",
    imageWidth: 80,
    imageHeight: 80,
    links: [
      { href: "https://xona-agent.com", label: "Visit Xona", external: true },
      { href: `${APP_URL}/docs/partners/xona-agent`, label: "Partner notes" },
    ],
  },
  {
    id: "oobe",
    name: "OOBE",
    src: "/branding/oobe/oobe-wordmark.png",
    label: "OOBE ecosystem partner",
    partnerType: "Agent registration",
    status: "live",
    text: "Solana agent registration infrastructure indexed into the AgentRanking graph.",
    className: "h-8 w-auto max-h-8 object-contain",
    imageWidth: 140,
    imageHeight: 48,
    links: [{ href: oobeLinks()[0]?.href ?? "https://explorer.oobeprotocol.ai", label: "OOBE Explorer", external: true }],
  },
  {
    id: "synapse",
    name: "Synapse",
    src: "/news/articles/synapse-rpc-logo.png",
    label: "Infrastructure",
    partnerType: "RPC & registry",
    status: "live",
    text: "Synapse listings strengthen discovery, filters, and reputation signals.",
    className: "h-8 w-8 max-h-8 object-contain",
    imageWidth: 80,
    imageHeight: 80,
    links: [{ href: `${APP_URL}/sap`, label: "View OOBE agents" }],
  },
  {
    id: "covenant",
    name: "Covenant",
    src: "/branding/covenant/covenant-logo.png",
    label: "OpenCovenant",
    partnerType: "Runtime verification",
    status: "live",
    text: "Runtime provenance and audit roots surfaced on agent profiles.",
    className: "h-8 w-8 object-contain",
    imageWidth: 80,
    imageHeight: 80,
    links: [{ href: `${APP_URL}/covenant`, label: "View Covenant" }],
  },
  {
    id: "hatcher",
    name: "Hatcher Labs",
    src: HATCHER_LOGO_SRC,
    label: "Partner agent network",
    partnerType: "Public agent index",
    status: "indexed",
    text: "Public agent index partner feeding discovery and reputation signals.",
    className: "h-9 w-9 rounded-lg object-contain",
    imageWidth: 80,
    imageHeight: 80,
    links: [{ href: `${APP_URL}/hatcher`, label: "View agents" }],
  },
  {
    id: "metaplex",
    name: "Metaplex",
    src: METAPLEX_LOGO_SRC,
    label: "Agent Registry",
    partnerType: "Solana registry",
    status: "indexed",
    text: "MPL Core agents with AgentIdentity indexed from the Metaplex registry on Solana.",
    className: "h-8 w-8 max-h-8 rounded-sm object-contain",
    imageWidth: 80,
    imageHeight: 80,
    links: [{ href: `${APP_URL}/metaplex`, label: "Metaplex hub" }],
  },
  {
    id: "hyre",
    name: "Hyre",
    src: "/branding/hyre/hyre-logo.png",
    label: "Ecosystem partner",
    partnerType: "Agent operations",
    status: "coming_soon",
    text: "Agent operations and hiring workflows tied to discovery context.",
    className: "h-9 w-9 rounded-lg object-contain",
    imageWidth: 80,
    imageHeight: 80,
    links: [{ href: "https://x.com/Hyre_agent", label: "Follow on X", external: true }],
  },
  {
    id: "earnfi",
    name: "EarnFi",
    src: "/partners/earnfi/icon.png",
    label: "Jobs partner",
    partnerType: "Campaigns",
    status: "live",
    text: "Agent-ready campaigns and bounties indexed into MCP Jobs.",
    className: "h-8 w-8 rounded-md object-contain",
    imageWidth: 64,
    imageHeight: 64,
    links: [{ href: `${APP_URL}/jobs`, label: "View jobs" }],
  },
  {
    id: "wurk",
    name: "WURK",
    src: "/partners/wurk/icon.png",
    label: "Jobs partner",
    partnerType: "Marketplace",
    status: "live",
    text: "Partner job listings synced into the AgentRanking jobs graph.",
    className: "h-8 w-8 rounded-md object-contain",
    imageWidth: 64,
    imageHeight: 64,
    links: [{ href: `${APP_URL}/jobs`, label: "View jobs" }],
  },
  {
    id: "said",
    name: "SAID",
    src: "/partners/said/logo.png",
    label: "Identity partner",
    partnerType: "Agent identity",
    status: "partner",
    text: "Agent identity and reputation signals for discovery context.",
    className: "h-[22px] w-[22px] object-contain",
    imageWidth: 64,
    imageHeight: 64,
    links: [{ href: `${APP_URL}/docs/partners`, label: "Partner docs" }],
  },
  {
    id: "qwerti",
    name: "Qwerti",
    src: "/partners/qwerti/logo.png",
    label: "Swap partner",
    partnerType: "Third-party widget",
    status: "live",
    text: "Optional $AR purchase widget — trades executed by Qwerti, not AgentRanking.",
    className: "h-[22px] w-[22px] object-contain",
    imageWidth: 64,
    imageHeight: 64,
    links: [{ href: "https://qwerti.ai", label: "Qwerti", external: true }],
  },
  {
    id: "acepyr",
    name: "Acepyr",
    src: "/partners/acepyr/logo.png",
    label: "Ecosystem partner",
    partnerType: "Agent platform",
    status: "partner",
    text: "Ecosystem partner integrated with AgentRanking discovery and signal.",
    className: "h-[22px] w-[22px] object-contain",
    imageWidth: 64,
    imageHeight: 64,
    links: [{ href: `${APP_URL}/docs/partners`, label: "Partner docs" }],
  },
  {
    id: "medusa",
    name: "Medusa",
    src: "/partners/medusa/logo.png",
    label: "Privacy credentials",
    partnerType: "Wallet reputation",
    status: "indexed",
    text: "Privacy layer for Solana wallet reputation — Medusa Passports and ZK eligibility on AgentRanking.",
    className: "h-[22px] w-[22px] object-contain",
    imageWidth: 64,
    imageHeight: 64,
    links: [{ href: `${APP_URL}/docs/partners/medusa`, label: "Partner docs" }],
  },
] as const satisfies readonly PublicSitePartner[];
