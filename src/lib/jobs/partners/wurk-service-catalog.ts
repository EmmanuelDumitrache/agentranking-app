/**
 * WURK service families for Jobs UI context — not PartnerJob rows.
 * Used for category browsing and partner education; does not inflate job counts.
 */
export type WurkServiceCatalogItem = {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  docsUrl: string;
  routeFamily?: string;
};
const WURK_DEVELOPER_URL = "https://wurk.fun/docs";
export const WURK_SERVICE_CATALOG: WurkServiceCatalogItem[] = [
  {
    id: "human-feedback",
    name: "Human Feedback",
    category: "Human Feedback",
    description: "Agents hire humans to review outputs, rate quality, and provide structured opinions.",
    tags: ["human-in-loop", "feedback", "agenttohuman"],
    docsUrl: WURK_DEVELOPER_URL,
    routeFamily: "agenttohuman",
  },
  {
    id: "product-review",
    name: "Product Review",
    category: "Product Review",
    description: "Human reviewers evaluate products, UX flows, copy, and deliver actionable critique.",
    tags: ["reviews", "feedback", "human-in-loop"],
    docsUrl: WURK_DEVELOPER_URL,
    routeFamily: "agenttohuman",
  },
  {
    id: "polls-opinions",
    name: "Polls / Opinions",
    category: "Polls / Opinions",
    description: "Collect human votes, preferences, and sentiment for agent decision support.",
    tags: ["polls", "opinions", "human-in-loop"],
    docsUrl: WURK_DEVELOPER_URL,
    routeFamily: "agenttohuman",
  },
  {
    id: "tagging-categorization",
    name: "Tagging / Categorization",
    category: "Tagging / Categorization",
    description: "Label, classify, and organize content with human judgment for training and QA.",
    tags: ["tagging", "moderation", "categorization"],
    docsUrl: WURK_DEVELOPER_URL,
    routeFamily: "agenttohuman",
  },
  {
    id: "x-twitter",
    name: "X / Twitter",
    category: "X / Twitter",
    description: "Human execution for likes, comments, follows, and community actions on X.",
    tags: ["social", "twitter", "x"],
    docsUrl: WURK_DEVELOPER_URL,
    routeFamily: "xlikes",
  },
  {
    id: "telegram-discord",
    name: "Telegram / Discord",
    category: "Telegram / Discord",
    description: "Community growth and moderation tasks across Telegram and Discord channels.",
    tags: ["telegram", "discord", "community"],
    docsUrl: WURK_DEVELOPER_URL,
    routeFamily: "tgmembers",
  },
  {
    id: "youtube",
    name: "YouTube",
    category: "YouTube",
    description: "Engagement and feedback workflows for YouTube creators and agent campaigns.",
    tags: ["youtube", "social", "video"],
    docsUrl: WURK_DEVELOPER_URL,
  },
  {
    id: "instagram",
    name: "Instagram",
    category: "Instagram",
    description: "Human tasks for Instagram engagement, tagging, and creator workflows.",
    tags: ["instagram", "social"],
    docsUrl: WURK_DEVELOPER_URL,
  },
  {
    id: "dexscreener-votes",
    name: "DexScreener / Votes",
    category: "DexScreener / Votes",
    description: "Community voting, DexScreener reactions, and on-chain-adjacent social proof tasks.",
    tags: ["dex", "votes", "community"],
    docsUrl: WURK_DEVELOPER_URL,
    routeFamily: "dex",
  },
  {
    id: "community-growth",
    name: "Community Growth",
    category: "Community Growth",
    description: "Amplify launches, grow channels, and coordinate human-powered growth loops.",
    tags: ["growth", "community", "social"],
    docsUrl: WURK_DEVELOPER_URL,
  },
];
export function getWurkServiceCatalog(): WurkServiceCatalogItem[] {
  return WURK_SERVICE_CATALOG;
}